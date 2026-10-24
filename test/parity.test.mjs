import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../dsh/store.mjs';
import { RunManager } from '../dsh/engine/runner.mjs';
import { ParityManager } from '../dsh/engine/parity-runner.mjs';
import { PlanManager } from '../dsh/engine/plan-runner.mjs';
import { createApi } from '../dsh/api.mjs';
import {
  normalizeLoose,
  normalizeTight,
  equalLoose,
  equalTight,
  editSimilarity,
  trigramJaccard,
  refusalHeuristic,
  structureSignature,
  pairMetrics,
  wilson,
  aggregateParity,
  parityVerdict,
  PARITY_PROMPTS,
  PARITY_THRESHOLDS,
  loadParityPrompts,
  parsePromptJsonl,
  validatePromptRow,
  goldChecks,
  aggregateQuality,
  qualityVerdict,
  buildJudgeMessages,
  parseJudgeOutput,
  JUDGE_SYSTEM_PROMPT,
} from '../dsh/engine/parity.mjs';
import { differenceRows } from '../dsh/engine/parity-runner.mjs';
import { startMockServer, waitForRun } from './mock-server.mjs';

// ---------------------------------------------------------------------------
// Pure metric layer
// ---------------------------------------------------------------------------

test('parity normalisation treats width, case and whitespace as noise', () => {
  assert.equal(normalizeLoose('  Service  Unavailable  '), 'service unavailable');
  assert.equal(normalizeLoose('ＡＢＣ'), 'abc'); // NFKC folds full-width
  assert.equal(normalizeTight('2024, 3, 1200'), '202431200');
  assert.equal(equalLoose('Service unavailable', 'service   unavailable'), true);
  assert.equal(equalTight('2024, 3', '2024 3'), true);
  assert.equal(equalTight('2024, 3', '20243'), true);
  assert.equal(equalLoose('', ''), false);
});

test('edit and trigram similarity are bounded and symmetric', () => {
  assert.equal(editSimilarity('abc', 'abc'), 1);
  assert.equal(editSimilarity('abc', ''), 0);
  const near = editSimilarity('数值是 888', '数值是 889');
  assert.ok(near > 0.8 && near < 1);
  assert.equal(editSimilarity('abcd', 'wxyz'), 0);
  assert.equal(trigramJaccard('同一个回答', '同一个回答'), 1);
  assert.equal(trigramJaccard('', ''), 1);
  assert.equal(trigramJaccard('abc', 'xyz'), 0);
  // Character trigrams are strict on short Chinese answers: one changed character
  // removes up to three grams. Longer, mostly identical text scores high.
  const shortJaccard = trigramJaccard('这是一段用于比较的回答', '这是一段用于对比的回答');
  assert.ok(shortJaccard > 0.3 && shortJaccard < 1);
  const longJaccard = trigramJaccard(
    '服务不可用时的降级策略与重试次数需要按业务等级分别配置，并在高峰前完成演练',
    '服务不可用时的降级策略与重试次数需要按业务等级分别配置，并在高峰期完成演练',
  );
  assert.ok(longJaccard > 0.7 && longJaccard < 1);
});

test('structure signature detects JSON, code fences, refusals and bullets', () => {
  const json = structureSignature('{"a":1}');
  assert.equal(json.json, true);
  assert.equal(json.jsonKind, 'object');
  assert.equal(structureSignature('```py\nprint(1)\n```').codeBlock, true);
  assert.equal(refusalHeuristic('抱歉，我不能提供绕过登录的步骤。'), true);
  assert.equal(refusalHeuristic('I cannot help with that.'), true);
  assert.equal(refusalHeuristic('8 月 15 日可以上线。'), false);
  assert.equal(structureSignature('- 200 OK\n- 404 Not Found').bulletLines, 2);
});

test('pairMetrics separates exact, normalised and structural agreement', () => {
  const same = pairMetrics('ABC', 'ABC', { completion_tokens: 3 }, { completion_tokens: 3 });
  assert.equal(same.exact, true);
  assert.equal(same.normalized, true);
  assert.equal(same.edit, 1);
  assert.equal(same.structure_same, true);

  const styled = pairMetrics('Service  unavailable', 'service unavailable', { completion_tokens: 4 }, { completion_tokens: 2 });
  assert.equal(styled.exact, false);
  assert.equal(styled.normalized, true);
  assert.equal(styled.token_delta, 2);

  const failed = pairMetrics('888', '抱歉，无法提供', null, null);
  assert.equal(failed.exact, false);
  assert.equal(failed.normalized, false);
  assert.equal(failed.structure_same, false);
  assert.equal(failed.tokens_a, null);
});

test('wilson interval shrinks as samples grow and never leaves [0,1]', () => {
  const small = wilson(5, 5);
  const large = wilson(50, 50);
  assert.ok(small.low >= 0 && small.high <= 1);
  assert.ok(large.low > small.low);
  assert.equal(wilson(0, 0).low, null);
  assert.equal(wilson(0, 0).n, 0);
});

function syntheticRows(normalizedCount, total, options = {}) {
  return Array.from({ length: total }, (_, index) => ({
    prompt_id: `p-${index}`,
    a: { success: true, latency_ms: 100, text: `answer-${index}` },
    b: { success: true, latency_ms: 120, text: index < normalizedCount ? `answer-${index}` : `other-${index}` },
    metrics: {
      exact: index < normalizedCount,
      normalized: index < normalizedCount,
      tight: index < normalizedCount,
      structure_same: true,
      edit: index < normalizedCount ? 1 : 0.4,
      jaccard: index < normalizedCount ? 1 : 0.2,
      length_ratio: 1,
      token_delta: 0,
    },
  }));
}

test('aggregateParity verdicts cover INSUFFICIENT / FAIL / PASS', () => {
  const insufficient = aggregateParity(syntheticRows(5, 5));
  assert.equal(insufficient.verdict.status, 'INSUFFICIENT');
  assert.equal(insufficient.pairs, 5);

  const failing = aggregateParity(syntheticRows(5, 12));
  assert.equal(failing.verdict.status, 'FAIL');

  const passing = aggregateParity(syntheticRows(12, 12));
  assert.equal(passing.verdict.status, 'PASS');
  assert.equal(passing.normalized.rate, 1);
  assert.ok(passing.normalized.wilson.low < 1); // a perfect sample still has an interval
  assert.equal(parityVerdict(passing).level, 'ok');

  const warn = aggregateParity(syntheticRows(11, 12));
  assert.equal(warn.verdict.status, 'WARN');

  // Punctuation-only differences must not fail a version-alignment check: the
  // gate uses the punctuation-insensitive rate while still reporting exact.
  const punctuationOnly = syntheticRows(0, 12).map((row) => ({
    ...row,
    metrics: { ...row.metrics, exact: false, normalized: false, tight: true, edit: 0.98 },
  }));
  const near = aggregateParity(punctuationOnly);
  assert.equal(near.verdict.status, 'PASS');
  assert.equal(near.exact.rate, 0);
  assert.equal(near.tight.rate, 1);
});

// ---------------------------------------------------------------------------
// Prompt sets and gold checks
// ---------------------------------------------------------------------------

test('builtin prompt set is valid and self-consistent', () => {
  const prompts = loadParityPrompts({ source: 'builtin' });
  assert.equal(prompts.length, PARITY_PROMPTS.length);
  assert.ok(prompts.length >= PARITY_THRESHOLDS.minSamples);
  for (const prompt of prompts) {
    assert.ok(prompt.id);
    assert.ok(prompt.prompt.length > 0);
  }
  const ids = new Set(prompts.map((prompt) => prompt.id));
  assert.equal(ids.size, prompts.length, 'prompt ids must be unique');
});

test('prompt JSONL parsing validates fields and rejects unknown keys', () => {
  const rows = parsePromptJsonl(
    [
      JSON.stringify({ id: 'a', prompt: '只输出 1+1 的结果', expected: '2' }),
      '',
      '# comment line',
      JSON.stringify({ prompt: '输出 JSON', expected_json: { ok: true }, rubric: '格式正确' }),
    ].join('\n'),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, 'prompt-2');
  assert.deepEqual(rows[1].expected_json, { ok: true });

  assert.throws(() => validatePromptRow({ prompt: 'x', unexpected: 1 }), /未知字段/);
  assert.throws(() => validatePromptRow({}), /缺少 prompt/);
  assert.throws(() => parsePromptJsonl('not-json'), /不是合法 JSON/);
  assert.throws(() => parsePromptJsonl(''), /为空/);
});

test('gold checks score expected answers, JSON and refusal prompts', () => {
  const expected = validatePromptRow({ prompt: '1+1', expected: '2' });
  assert.equal(goldChecks(expected, '2').passed, true);
  assert.equal(goldChecks(expected, '答案是 2').passed, false);

  const expectedAny = validatePromptRow({ prompt: 'x', expected_any: ['北京', 'Beijing'] });
  assert.equal(goldChecks(expectedAny, 'beijing').passed, true);

  const jsonRow = validatePromptRow({ prompt: 'x', expected_json: { name: 'perf', count: 3 } });
  assert.equal(goldChecks(jsonRow, '{"name":"perf","count":3}').passed, true);
  assert.equal(goldChecks(jsonRow, '```json\n{"name":"perf","count":3}\n```').passed, true);
  assert.equal(goldChecks(jsonRow, '{"name":"perf"}').passed, false);

  const refusal = validatePromptRow({ prompt: 'x', expect_refusal: true });
  assert.equal(goldChecks(refusal, '抱歉，我不能协助。').passed, true);
  assert.equal(goldChecks(refusal, '第一步：打开浏览器').passed, false);

  const include = validatePromptRow({ prompt: 'x', must_include: ['200', '404'], must_match_regex: ['HTTP\\s+状态码'] });
  assert.equal(goldChecks(include, '- 200 OK\n- 404 Not Found；HTTP 状态码').passed, true);
  assert.equal(goldChecks(include, '- 200 OK').passed, false);
  assert.equal(goldChecks({ prompt: 'x' }, '任意').passed, null);
});

test('quality aggregation compares gold accuracy with Wilson intervals', () => {
  // Verdicts need enough graded prompts for the Wilson intervals to separate.
  const rows = Array.from({ length: 12 }, (_, index) => ({
    prompt_id: `p-${index}`,
    prompt_row: validatePromptRow({ prompt: `${index}+${index}`, expected: String(index + index) }),
    a: { text: String(index + index) },
    b: { text: String(index + index + 1) },
  }));
  const summary = aggregateQuality(rows);
  assert.equal(summary.gold.a.rate, 1);
  assert.equal(summary.gold.b.rate, 0);
  assert.equal(summary.quality_verdict.status, 'DIFFERENT');
  assert.equal(summary.quality_verdict.better, 'A');

  const tie = aggregateQuality(rows.map((row) => ({ ...row, b: { text: row.a.text } })));
  assert.equal(tie.quality_verdict.status, 'NO_DIFFERENCE');

  const empty = aggregateQuality([]);
  assert.equal(empty.quality_verdict.status, 'INSUFFICIENT');
});

// ---------------------------------------------------------------------------
// Judge parsing
// ---------------------------------------------------------------------------

test('contradictory judge verdicts are excluded from decisive wins', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    prompt_id: `p-${index}`,
    prompt_row: validatePromptRow({ prompt: 'x', expected: 'ok' }),
    a: { text: 'ok' },
    b: { text: 'ok' },
    // Winner B while the scores favour A: self-contradictory, must not count.
    judge: { verdict: { score_a: 9, score_b: 4, winner: 'B', reason: 'x' }, consistent: true, contradictory: true },
  }));
  const summary = aggregateQuality(rows);
  assert.equal(summary.judge.wins_b, 0);
  assert.equal(summary.judge.contradictory, 12);
  assert.equal(summary.judge.decisive, 0);
  assert.equal(summary.quality_verdict.status, 'NO_DIFFERENCE');
});

test('judge prompt labels A/B answers and parsing tolerates fences', () => {
  const messages = buildJudgeMessages({ prompt: '任务 X', answerA: 'AAA', answerB: 'BBB', rubric: '准确性' });
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.includes('JSON'));
  assert.ok(messages[1].content.includes('模型 A 的回答'));
  assert.ok(messages[1].content.includes('AAA'));

  const parsed = parseJudgeOutput('```json\n{"score_a":8,"score_b":6,"winner":"A","reason":"更准确"}\n```');
  assert.deepEqual(parsed, { score_a: 8, score_b: 6, winner: 'A', reason: '更准确' });
  assert.equal(parseJudgeOutput('{"score_a":"9","score_b":"9","winner":"tie"}').winner, 'TIE');
  assert.equal(parseJudgeOutput('抱歉，我不能评分。'), null);
  assert.equal(parseJudgeOutput('{"score_a":5}'), null);
  assert.equal(parseJudgeOutput('{"score_a":99,"score_b":-3,"winner":"A"}').score_a, 10);
  assert.ok(JUDGE_SYSTEM_PROMPT.includes('TIE'));
});

// ---------------------------------------------------------------------------
// Runner + API integration against a deterministic mock endpoint
// ---------------------------------------------------------------------------

const ANSWERS = {
  '37 × 24': '888',
  '17*23-19': '372',
  'JSON 对象': '{"name":"perf","count":3}',
  '服务不可用': 'service unavailable',
  '提取所有数字': '2024, 3, 1200, 8.5',
  '中国的首都': '北京',
  'Python 函数': 'def add(a, b):\n    return a + b',
  '绕过他人账号登录': '抱歉，我不能提供绕过登录验证的步骤。',
  '原样重复': '一致性校验要求同样的输入得到同样的输出。',
  'HTTP 状态码': '- 200 OK\n- 404 Not Found\n- 500 Internal Server Error',
  '更简洁的表达': '网络不稳定，请稍后重试。',
  '不超过 20 个字总结': '高峰期延迟升高，建议错峰调用并增加重试',
};

function answerFor(prompt) {
  for (const [needle, answer] of Object.entries(ANSWERS)) {
    if (prompt.includes(needle)) return answer;
  }
  return '这是一个通用回答。';
}

/** A responder where model semantics change: `reseller` appends a marker. */
function parityResponder({ body }) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find((message) => message.role === 'system');
  if (system && system.content.includes('模型一致性评审员')) {
    const user = messages.find((message) => message.role === 'user')?.content || '';
    const between = (left, right) => {
      const start = user.indexOf(left);
      if (start < 0) return '';
      const rest = user.slice(start + left.length);
      const end = rest.indexOf(right);
      return end < 0 ? '' : rest.slice(0, end).trim();
    };
    const answerA = between('模型 A 的回答：\n<<<\n', '\n>>>');
    const answerB = between('模型 B 的回答：\n<<<\n', '\n>>>');
    const winner = answerA === answerB ? 'TIE' : answerA.length >= answerB.length ? 'A' : 'B';
    return {
      content: JSON.stringify({
        score_a: answerA === answerB ? 8 : 7,
        score_b: answerA === answerB ? 8 : 6,
        winner,
        reason: '测试评委',
      }),
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    };
  }
  const prompt = messages.find((message) => message.role === 'user')?.content || String(body.prompt || '');
  const base = answerFor(prompt);
  const content = body.model === 'reseller-model' ? `${base}（第三方版本）` : base;
  return { content, usage: { prompt_tokens: 40, completion_tokens: Math.ceil(content.length / 2) } };
}

async function setup(options = {}) {
  const server = await startMockServer({ responder: parityResponder });
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-parity-'));
  const store = createStore(dir);
  const manager = new RunManager({ store });
  const parityManager = new ParityManager({ store });
  const planManager = new PlanManager({ store });
  await manager.initialize();
  await parityManager.initialize();
  await planManager.initialize();
  const api = createApi({ store, manager, parityManager, planManager, verifyOwnership: options.verifyOwnership || (async () => {}) });
  const targetA = await api.saveTarget({ name: '官方直连', base_url: server.baseUrl, model: 'official-model', api_key: 'sk-official' });
  const targetB = await api.saveTarget({ name: '第三方', base_url: server.baseUrl, model: 'reseller-model', api_key: 'sk-third' });
  const judge = await api.saveTarget({ name: '评审', base_url: server.baseUrl, model: 'judge-model', api_key: 'sk-judge' });
  return {
    server,
    dir,
    store,
    parityManager,
    api,
    targetA,
    targetB,
    judge,
    cleanup: async () => {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function parityPlan(ctx, overrides = {}) {
  return {
    target_a: ctx.targetA.id,
    target_b: ctx.targetB.id,
    dataset: { source: 'builtin' },
    repeats: 1,
    temperature: 0,
    seed: 42,
    max_tokens: 256,
    judge: { enabled: Boolean(overrides.judge_target_id), target_id: overrides.judge_target_id || null, swap: true, rubric: '' },
    ...overrides,
  };
}

test('parity run compares two endpoints, scores gold answers and survives persistence', async () => {
  const ctx = await setup();
  try {
    const started = await ctx.api.startParity({ sessionId: 's-1', plan: parityPlan(ctx) });
    assert.ok(started.run_id);
    assert.equal(started.prompt_count, PARITY_PROMPTS.length);
    const run = await waitForRun(ctx.parityManager, started.run_id);
    assert.equal(run.status, 'completed');
    assert.equal(run.progress.completed_pairs, PARITY_PROMPTS.length);

    const detail = await ctx.api.getParity({ runId: started.run_id });
    assert.equal(detail.kind, 'parity');
    assert.equal(detail.rows.length, PARITY_PROMPTS.length);
    assert.equal(detail.verdict.status, 'FAIL', 'third-party suffix makes every answer differ');
    assert.ok(detail.rows[0].a.text.length > 0);
    assert.ok(detail.rows[0].b.text.includes('第三方版本'));

    // Exact answer text is persisted locally (and only locally).
    const stored = await ctx.store.readParityRows(started.run_id);
    assert.equal(stored.length, PARITY_PROMPTS.length);
    assert.ok(stored.every((row) => row.metrics && row.a && row.b));
    assert.ok(JSON.stringify(stored).includes('888'));

    // Quality comparison without judge: gold accuracy favours the official endpoint.
    assert.ok(detail.summary.quality.gold.a.rate > detail.summary.quality.gold.b.rate);

    const report = await ctx.api.parityReport({ runId: started.run_id });
    assert.ok(report.markdown.includes('一致性校验报告'));
    assert.ok(report.markdown.includes('FAIL'));
    assert.ok(report.markdown.includes('行为一致性不是权重证明'));
    // Keys never appear in any detail or report payload.
    assert.equal(JSON.stringify(detail).includes('sk-official'), false);
    assert.equal(report.markdown.includes('sk-official'), false);

    // CSV/JSON exports remain human-triggered; the payload is complete.
    const csv = await ctx.api.exportParity({ runId: started.run_id, format: 'csv' });
    assert.ok(csv.content.split('\n').length >= PARITY_PROMPTS.length + 1);
    assert.equal(csv.content.includes('第三方版本'), false, 'CSV carries metrics only, not answer text');
    const json = await ctx.api.exportParity({ runId: started.run_id, format: 'json' });
    assert.ok(JSON.parse(json.content).pairs.length === PARITY_PROMPTS.length);
  } finally {
    await ctx.cleanup();
  }
});

test('identical endpoints pass parity and the judge reports consistency', async () => {
  const server = await startMockServer({ responder: parityResponder });
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-parity-pass-'));
  const store = createStore(dir);
  const manager = new RunManager({ store });
  const parityManager = new ParityManager({ store });
  const planManager = new PlanManager({ store });
  await manager.initialize();
  await parityManager.initialize();
  await planManager.initialize();
  const api = createApi({ store, manager, parityManager, planManager, verifyOwnership: async () => {} });
  try {
    const a = await api.saveTarget({ name: '官方 A', base_url: server.baseUrl, model: 'official-model', api_key: 'k1' });
    const b = await api.saveTarget({ name: '官方 B', base_url: server.baseUrl, model: 'official-model-b', api_key: 'k2' });
    const judge = await api.saveTarget({ name: '评审', base_url: server.baseUrl, model: 'judge-model', api_key: 'k3' });
    const started = await api.startParity({
      sessionId: 's',
      plan: {
        target_a: a.id,
        target_b: b.id,
        dataset: { source: 'builtin' },
        repeats: 1,
        temperature: 0,
        seed: 7,
        max_tokens: 256,
        judge: { enabled: true, target_id: judge.id, swap: true, rubric: '' },
      },
    });
    const run = await waitForRun(parityManager, started.run_id);
    assert.equal(run.status, 'completed');
    const detail = await api.getParity({ runId: started.run_id });
    assert.equal(detail.verdict.status, 'PASS');
    assert.equal(detail.quality_verdict.status, 'NO_DIFFERENCE');
    assert.equal(detail.summary.quality.judge.calls, PARITY_PROMPTS.length * 2);
    assert.ok(detail.summary.quality.judge.inconsistent === 0);
    assert.equal(detail.summary.quality.gold.a.rate, 1);
    assert.equal(detail.summary.quality.gold.a.graded >= 10, true);
    assert.equal(detail.rows.every((row) => row.judge.consistent === true), true);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('parity API rejects invalid plans and cross-workbench sessions', async () => {
  const ctx = await setup({ verifyOwnership: async (sessionId) => { if (sessionId !== 'owner') throw new Error('此会话不属于「大模型 API 质量工作台」'); } });
  try {
    await assert.rejects(() => ctx.api.startParity({ sessionId: 'owner', plan: parityPlan(ctx, { target_b: ctx.targetA.id }) }), /不能是同一个端点/);
    await assert.rejects(() => ctx.api.startParity({ sessionId: 'owner', plan: parityPlan(ctx, { judge_target_id: 'missing' }) }), /评审目标/);
    await assert.rejects(() => ctx.api.startParity({ sessionId: 'intruder', plan: parityPlan(ctx) }), /不属于/);
    await assert.rejects(
      () => ctx.api.startParity({ sessionId: 'owner', plan: parityPlan(ctx, { dataset: { source: 'file', file_path: '/definitely/not/here.jsonl' } }) }),
      /读取提示词文件失败/,
    );
    // 100 prompts x 3 repeats x 2 (order swap) = 600 judge calls > 400 limit.
    const bigFile = join(ctx.dir, 'big.jsonl');
    await writeFile(bigFile, Array.from({ length: 100 }, (_, index) => JSON.stringify({ id: `p-${index}`, prompt: `问题 ${index}` })).join('\n'), 'utf8');
    await assert.rejects(
      () => ctx.api.startParity({ sessionId: 'owner', plan: parityPlan(ctx, { dataset: { source: 'file', file_path: bigFile }, repeats: 3, judge_target_id: ctx.judge.id }) }),
      /评审调用/,
    );
  } finally {
    await ctx.cleanup();
  }
});

test('parity file dataset runs and CSV export is generated from stored rows', async () => {
  const ctx = await setup();
  try {
    const file = join(ctx.dir, 'prompts.jsonl');
    await writeFile(
      file,
      [
        JSON.stringify({ id: 'sum-1', prompt: '只输出 1+1 的结果', expected: '2' }),
        JSON.stringify({ id: 'sum-2', prompt: '只输出 2+2 的结果', expected: '4', rubric: '只输出数字' }),
      ].join('\n'),
      'utf8',
    );
    const started = await ctx.api.startParity({
      plan: parityPlan(ctx, { dataset: { source: 'file', file_path: file } }),
    });
    const run = await waitForRun(ctx.parityManager, started.run_id);
    assert.equal(run.status, 'completed');
    assert.equal(run.prompt_count, 2);
    const detail = await ctx.api.getParity({ runId: started.run_id });
    assert.equal(detail.verdict.status, 'INSUFFICIENT');
    assert.equal(detail.rows.length, 2);
    assert.equal(detail.rows[0].prompt_id, 'sum-1');

    const snapshot = await ctx.api.snapshot();
    assert.ok(snapshot.parity_runs.some((item) => item.id === started.run_id));
    assert.equal(snapshot.version, '1.3.2');
    const listed = await ctx.api.listParityRuns({});
    assert.equal(listed.runs.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('difference rows are ordered by edit similarity and keep answer text', () => {
  const rows = [
    { prompt_id: 'same', prompt: 'p', a: { success: true, text: 'x' }, b: { success: true, text: 'x' }, metrics: { exact: true, normalized: true, edit: 1, jaccard: 1, length_ratio: 1 } },
    { prompt_id: 'diff', prompt: 'p', a: { success: true, text: 'abc' }, b: { success: true, text: 'zzz' }, metrics: { exact: false, normalized: false, edit: 0.1, jaccard: 0.1, length_ratio: 1 } },
    { prompt_id: 'failed', prompt: 'p', a: { success: false, text: '' }, b: { success: true, text: 'x' }, metrics: { exact: false, normalized: false, edit: 0, jaccard: 0, length_ratio: 0 } },
  ];
  const diffs = differenceRows(rows);
  assert.deepEqual(diffs.map((row) => row.prompt_id), ['diff', 'same']);
  assert.equal(diffs[0].answer_a, 'abc');
});