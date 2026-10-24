import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../dsh/store.mjs';
import { RunManager, normalizeTarget } from '../dsh/engine/runner.mjs';
import { ParityManager } from '../dsh/engine/parity-runner.mjs';
import { PlanManager } from '../dsh/engine/plan-runner.mjs';
import { createApi } from '../dsh/api.mjs';
import { startMockServer, waitForRun } from './mock-server.mjs';
import {
  STANDARD_PLANS,
  PLAN_LIMITS,
  buildPlanItems,
  buildLongContextItems,
  planChecks,
  aggregatePlanResults,
  planVerdicts,
  compareTargets,
  usageAudit,
  parsePlanJudge,
  estimatePlan,
  findPlan,
} from '../dsh/engine/plans.mjs';

const GOLD = [
  ['最大的海洋', '太平洋'],
  ['最长的河流', '长江'],
  ['红楼梦', '曹雪芹'],
  ['水的化学式', 'H2O'],
  ['白昼最长', '夏至'],
  ['第一次世界大战', '1914'],
];
const INSTRUCTION_GOLD = [
  ['东京所在的国家', '{"city":"东京","country":"日本"}'],
  ['hello world 转成大写', 'HELLO WORLD'],
  ['千分位', '1,234,567'],
  ['法语表达「谢谢」', 'merci'],
  ['结论：', '结论：阅读能提升写作。'],
  ['1 到 5 的 JSON 数组', '[1,2,3,4,5]'],
];

function strongAnswer(prompt) {
  for (const [needle, answer] of [...GOLD, ...INSTRUCTION_GOLD]) {
    if (prompt.includes(needle)) return answer;
  }
  return '不知道。';
}

/** 强模型答对；弱模型答错（用来检验 A/B 质量差）。 */
function goldResponder(strings) {
  return ({ body }) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.find((message) => message.role === 'system')?.content || '';
    const prompt = messages.find((message) => message.role === 'user')?.content || String(body.prompt || '');
    if (system.includes('模型质量评审员')) {
      const score = /<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1]?.includes('不知道') ? 1 : 8;
      return { content: JSON.stringify({ score, correct: score >= 6, reason: 'mock 评审' }), usage: { prompt_tokens: 20, completion_tokens: 12 } };
    }
    const text = body.model === 'weak-model' ? '不知道。' : strongAnswer(prompt);
    return {
      content: text,
      usage: {
        prompt_tokens: 30,
        completion_tokens: Math.max(1, Math.ceil(text.length / 2)),
        ...(strings.cache ? { prompt_tokens_details: { cached_tokens: 0 } } : {}),
      },
    };
  };
}

async function setupPlan(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-plan-'));
  const store = createStore(dir);
  const manager = new RunManager({ store });
  const parityManager = new ParityManager({ store });
  const planManager = new PlanManager({ store });
  await manager.initialize();
  await parityManager.initialize();
  await planManager.initialize();
  const api = createApi({ store, manager, parityManager, planManager, verifyOwnership: async () => {} });
  const server = await startMockServer({ responder: goldResponder(options) });
  const targets = [];
  for (const model of ['strong-model', 'weak-model', 'judge-model']) {
    const target = normalizeTarget({ name: model, base_url: `${server.baseUrl}/v1`, model, api_key: 'sk-plan-test' });
    targets.push(target);
  }
  await store.writeTargets(targets);
  return {
    dir,
    store,
    planManager,
    api,
    server,
    targets,
    cleanup: async () => {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('standard plans are internally consistent and buildable', () => {
  assert.ok(STANDARD_PLANS.length >= 6);
  const ids = new Set(STANDARD_PLANS.map((plan) => plan.id));
  assert.equal(ids.size, STANDARD_PLANS.length);
  for (const plan of STANDARD_PLANS) {
    if (plan.engine === 'parity' || plan.engine === 'bench') continue;
    assert.equal(plan.engine, 'plan', plan.id);
    assert.ok(plan.references.length >= 1, `${plan.id} 需要方法依据`);
    const items = buildPlanItems(plan.id);
    assert.ok(items.length >= 6, `${plan.id} 题目过少`);
    for (const item of items) {
      assert.ok(item.id && item.dimension && item.prompt);
      assert.ok(item.prompt.length < PLAN_LIMITS.maxContextChars);
    }
  }
  assert.equal(findPlan('capability-spot').engine, 'plan');
  assert.equal(findPlan('parity-official').engine, 'parity');
  assert.equal(findPlan('perf-slo').engine, 'bench');
});

test('long-context items embed the needle at each depth and length', () => {
  const items = buildLongContextItems({ lengths: [4000, 16000], depths: ['front', 'middle', 'end'] });
  assert.equal(items.length, 6);
  for (const item of items) {
    assert.equal(item.dimension, 'long_context');
    assert.equal(item.approx_prompt_chars, item.prompt.length);
    const code = item.expected_any[0];
    assert.ok(item.prompt.includes(`【验证码：${code}】`));
    assert.ok(item.prompt.length >= 1200);
    assert.equal(item.prompt.split(code).length - 1, 1);
  }
  const middle = items.find((item) => item.id === 'lc-4000-middle');
  const index = middle.prompt.indexOf('验证码');
  assert.ok(index > middle.prompt.length * 0.15, '中间埋点不应在开头');
  assert.ok(index < middle.prompt.length * 0.6, '中间埋点不应在结尾');
  assert.throws(() => buildLongContextItems({ lengths: [100], depths: ['front'] }), /1200/);
});

test('planChecks handles gold values, JSON, constraints and refusals', () => {
  assert.equal(planChecks({ expected_any: ['372'] }, ' 372\n').pass, true);
  assert.equal(planChecks({ expected_any: ['372'] }, '三百七十二').pass, false);
  assert.equal(planChecks({ expected_json: { a: 1 } }, '```json\n{"a": 1}\n```').pass, true);
  assert.equal(planChecks({ expected_json: [1, 2, 3] }, '[3,2,1]').pass, false);
  assert.equal(planChecks({ exact_text: 'HELLO WORLD' }, 'hello world').pass, false);
  assert.equal(planChecks({ exact_text: 'HELLO WORLD' }, 'HELLO WORLD').pass, true);
  assert.equal(planChecks({ max_chars: 5 }, '123456').pass, false);
  assert.equal(planChecks({ start_with: '结论：' }, '结论：可以。').pass, true);
  assert.equal(planChecks({ start_with: '结论：' }, '可以。').pass, false);
  assert.equal(planChecks({ bullet_count: 2 }, '- 一\n- 二\n- 三').pass, false);
  assert.equal(planChecks({ forbid_regex: '[#*`]' }, '一句**加粗**').pass, false);
  assert.equal(planChecks({ must_include: ['42', 'answer'] }, 'answer is 42').pass, true);
  assert.equal(planChecks({ expect_refusal: true }, '抱歉，我不能提供这个。').pass, true);
  assert.equal(planChecks({ expect_refusal: true }, '第一步，先打开设置。').pass, false);
  assert.equal(planChecks({ expect_refusal: false, min_chars: 10 }, '当然可以，下面说明。').pass, true);
  assert.equal(planChecks({ expect_refusal: false, min_chars: 10 }, '抱歉，我不能回答。').pass, false);
  assert.equal(planChecks({ note: '只有评审' }, '任意').graded, false);
  const failed = planChecks({ must_include: ['42'], expected_any: ['x'] }, '42');
  assert.equal(failed.pass, false);
  assert.equal(failed.checks.filter((check) => !check.pass).length, 1);
});

test('aggregatePlanResults / planVerdicts / compareTargets produce honest statuses', () => {
  const items = [];
  const add = (id, dimension, aPass, bPass) => {
    items.push({
      id,
      dimension,
      targets: {
        a: { graded: true, pass: aPass },
        b: { graded: true, pass: bPass },
      },
    });
  };
  for (let i = 0; i < 7; i += 1) add(`k${i}`, 'knowledge', true, false);
  for (let i = 0; i < 3; i += 1) add(`l${i}`, 'knowledge', true, true);
  const dimensions = aggregatePlanResults(items, ['a', 'b']);
  assert.equal(dimensions.knowledge.items, 10);
  assert.equal(dimensions.knowledge.targets.a.graded, 10);
  assert.equal(dimensions.knowledge.targets.a.passed, 10);
  assert.equal(dimensions.knowledge.targets.b.passed, 3);
  assert.ok(dimensions.knowledge.targets.a.wilson.low > 0.5);

  const verdicts = planVerdicts(dimensions);
  assert.equal(verdicts.overall.a.status, 'PASS');
  assert.equal(verdicts.overall.b.status, 'FAIL');
  const comparison = compareTargets(dimensions, verdicts);
  assert.equal(comparison.status, 'DIFFERENT');
  assert.equal(comparison.by_dimension.knowledge.status, 'DIFFERENT');

  const thin = aggregatePlanResults([{ id: 'x', dimension: 'custom', targets: { a: { graded: true, pass: true } } }], ['a']);
  const thinVerdicts = planVerdicts(thin);
  assert.equal(thinVerdicts.overall.a.status, 'INSUFFICIENT');
  assert.equal(compareTargets(thin, thinVerdicts).status, 'INSUFFICIENT');
});

test('usageAudit flags missing usage and absurd completion ratios', () => {
  const rows = [
    {
      id: 'u1',
      targets: {
        a: {
          samples: [
            { token_source: 'usage', prompt_tokens: 10, completion_tokens: 1000, text: '短', reported_model: 'strong-model', cached_tokens: 0 },
            { token_source: 'missing', text: '没有 usage' },
          ],
        },
      },
    },
    {
      id: 'u2',
      targets: { a: { samples: [{ token_source: 'usage', prompt_tokens: 12, completion_tokens: 6, text: '这是一段正常长度的回答文本', reported_model: 'strong-model' }] } },
    },
  ];
  const audit = usageAudit(rows, 'a');
  assert.equal(audit.responses, 3);
  assert.equal(audit.usage_reported, 2);
  assert.equal(audit.usage_missing, 1);
  assert.ok(audit.completion_ratio_outliers >= 1);
  assert.deepEqual(audit.reported_models, ['strong-model']);
  assert.match(audit.note, /tokenizer/);
});

test('parsePlanJudge tolerates fenced JSON and rejects garbage', () => {
  assert.deepEqual(parsePlanJudge('```json\n{"score": 7.6, "correct": true, "reason": "ok"}\n```'), { score: 8, correct: true, reason: 'ok' });
  assert.deepEqual(parsePlanJudge('{"score": 12, "correct": false}'), { score: 10, correct: false, reason: '' });
  assert.equal(parsePlanJudge('not json').score, null);
  assert.equal(parsePlanJudge('{"correct": true}').score, null);
});

test('plan runner scores a single target and writes plan rows', async (t) => {
  const ctx = await setupPlan();
  t.after(() => ctx.cleanup());
  const plan = {
    plan_id: 'custom',
    target_a: ctx.targets[0].id,
    dimensions: ['knowledge'],
    per_dimension: 3,
    temperature: 0,
    seed: 42,
    max_tokens: 64,
    judge: { enabled: false },
    thresholds: { minGradedTotal: 3 },
  };
  const run = await ctx.api.startPlan({ plan });
  const finished = await waitForRun(ctx.planManager, run.run_id);
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.summary.verdicts.overall.a.status, 'PASS');
  assert.equal(finished.summary.dimensions.knowledge.items, 3);
  assert.equal(finished.summary.requests, 3);
  const rows = await ctx.store.readPlanRows(run.run_id);
  assert.equal(rows.length, 3);
  assert.ok(rows[0].a.samples[0].text.length > 0);
  assert.equal(rows[0].a.graded, true);
  assert.ok(finished.summary.usage.a.usage_reported >= 1);
});

test('plan runner compares A vs B and reports DIFFERENT quality', async (t) => {
  const ctx = await setupPlan();
  t.after(() => ctx.cleanup());
  const plan = {
    plan_id: 'custom',
    target_a: ctx.targets[0].id,
    target_b: ctx.targets[1].id,
    dimensions: ['knowledge'],
    per_dimension: 6,
    temperature: 0,
    seed: 42,
    max_tokens: 64,
    judge: { enabled: false },
    thresholds: { minGradedTotal: 6 },
  };
  const run = await ctx.api.startPlan({ plan });
  const finished = await waitForRun(ctx.planManager, run.run_id);
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.summary.dimensions.knowledge.targets.a.passed, 6);
  assert.equal(finished.summary.dimensions.knowledge.targets.b.passed, 0);
  assert.equal(finished.summary.comparison.status, 'DIFFERENT');
  assert.equal(finished.summary.verdicts.overall.b.status, 'FAIL');
  assert.equal(finished.summary.requests, 12);
  assert.ok(finished.summary.failed_items.length >= 1);
});

test('plan runner supports LLM judge with bounded calls', async (t) => {
  const ctx = await setupPlan();
  t.after(() => ctx.cleanup());
  const plan = {
    plan_id: 'custom',
    target_a: ctx.targets[0].id,
    dimensions: ['knowledge'],
    per_dimension: 3,
    max_tokens: 64,
    judge: { enabled: true, target_id: ctx.targets[2].id, rubric: '是否正确' },
  };
  const run = await ctx.api.startPlan({ plan });
  const finished = await waitForRun(ctx.planManager, run.run_id);
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.summary.judge_calls, 3);
  assert.equal(finished.summary.judge.a.scored, 3);
  assert.ok(finished.summary.judge.a.mean_score >= 7);
});

test('plan API validates plans and exposes summaries/reports/exports', async (t) => {
  const ctx = await setupPlan();
  t.after(() => ctx.cleanup());

  await assert.rejects(
    () => ctx.api.startPlan({ plan: { plan_id: 'custom', target_a: ctx.targets[0].id, target_b: ctx.targets[0].id, dimensions: ['knowledge'] } }),
    /不能是同一个/,
  );
  await assert.rejects(
    () => ctx.api.startPlan({ plan: { plan_id: 'custom', target_a: ctx.targets[0].id, dimensions: ['knowledge'], judge: { enabled: true } } }),
    /评审/,
  );
  await assert.rejects(
    () => ctx.api.startPlan({ plan: { plan_id: 'custom', target_a: ctx.targets[0].id, dataset: { source: 'file', file_path: '/tmp/definitely-missing.jsonl' }, dimensions: ['custom'] } }),
    /读取自定义语料失败/,
  );
  await assert.rejects(
    () => ctx.api.startPlan({ plan: { plan_id: 'perf-slo', target_a: ctx.targets[0].id } }),
    /不是可直接执行/,
  );

  const run = await ctx.api.startPlan({ plan: { plan_id: 'capability-spot', target_a: ctx.targets[0].id, per_dimension: 2, max_tokens: 64 } });
  assert.ok(run.item_count >= 4);
  const finished = await waitForRun(ctx.planManager, run.run_id);
  assert.equal(finished.status, 'completed', finished.error);
  const detail = await ctx.api.getPlan({ runId: run.run_id });
  assert.equal(detail.summary.plan_id, 'capability-spot');
  assert.ok(Array.isArray(detail.rows));
  assert.ok(detail.rows[0].a.samples[0].text);
  const list = await ctx.api.listPlanRuns();
  assert.ok(list.runs.some((item) => item.id === run.run_id));
  assert.ok(list.plans.length >= 6);
  const report = await ctx.api.planReport({ runId: run.run_id });
  assert.match(report.markdown, /测试方案报告/);
  assert.match(report.markdown, /方法与局限/);
  const csv = await ctx.api.exportPlan({ runId: run.run_id, format: 'csv' });
  assert.match(csv.content, /item_id/);
  assert.ok(!csv.content.includes('太平洋'), 'CSV 不应包含回答原文');
  const json = await ctx.api.exportPlan({ runId: run.run_id, format: 'json' });
  assert.ok(JSON.parse(json.content).items.length >= 4);

  const snapshot = await ctx.api.snapshot();
  assert.ok(Array.isArray(snapshot.plans));
  assert.ok(Array.isArray(snapshot.plan_runs));
  assert.equal(snapshot.version, '1.3.2');
});

test('billing and mix audits run through the plan API with honest caveats', async (t) => {
  const ctx = await setupPlan();
  t.after(() => ctx.cleanup());
  const pricing = {
    enabled: true, currency: 'CNY', input: 2, output: 8, cached_input: 0.5,
    vendor_discount_pct: 0, batch_discount_pct: 50, timezone: 'Asia/Shanghai',
    windows: [{ label: '闲时', weekdays: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '08:00', multiplier: 0.5 }],
  };
  await ctx.store.writeTargets(ctx.targets.map((target) => ({ ...target, pricing: target.model === 'strong-model' ? pricing : null })));

  await assert.rejects(
    () => ctx.api.startPlan({ plan: { plan_id: 'billing-audit', target_a: ctx.targets[0].id, max_tokens: 32 } }),
    /需要目标 B/,
  );

  const billing = await ctx.api.startPlan({
    plan: { plan_id: 'billing-audit', target_a: ctx.targets[0].id, target_b: ctx.targets[1].id, max_tokens: 32, pricing_mode: 'batch' },
  });
  const billingDone = await waitForRun(ctx.planManager, billing.run_id);
  assert.equal(billingDone.status, 'completed', billingDone.error);
  assert.equal(billingDone.plan.pricing_mode, 'batch');
  assert.equal(billingDone.summary.billing_audit.status, 'PASS');
  assert.ok(billingDone.summary.billing_audit.pairs >= 12);
  assert.equal(billingDone.summary.billing_audit.cost.available, true);
  assert.equal(billingDone.summary.costs.a.available, true);
  assert.equal(billingDone.summary.costs.a.batch, true);
  const billingReport = await ctx.api.planReport({ runId: billing.run_id });
  assert.match(billingReport.markdown, /计费审计/);
  assert.match(billingReport.markdown, /成本与推理性价比/);
  assert.match(billingReport.markdown, /不是厂商账单/);

  const mix = await ctx.api.startPlan({
    plan: { plan_id: 'mix-audit', target_a: ctx.targets[0].id, target_b: ctx.targets[1].id, temperature: 0, max_tokens: 32 },
  });
  const mixDone = await waitForRun(ctx.planManager, mix.run_id);
  assert.equal(mixDone.status, 'completed', mixDone.error);
  assert.equal(mixDone.plan.temperature, 0.7);
  assert.equal(mixDone.plan.temperature_defaulted, true);
  assert.ok(['NO_EVIDENCE', 'INCONCLUSIVE', 'SUSPECT'].includes(mixDone.summary.routing_audit.status));
  const mixReport = await ctx.api.planReport({ runId: mix.run_id });
  assert.match(mixReport.markdown, /混推理审计/);
  assert.match(mixReport.markdown, /不能证明具体权重/);
});

test('model discovery lists models and surfaces endpoint errors', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-models-'));
  const store = createStore(dir);
  const manager = new RunManager({ store });
  const parityManager = new ParityManager({ store });
  const planManager = new PlanManager({ store });
  const api = createApi({ store, manager, parityManager, planManager, verifyOwnership: async () => {} });
  const server = await startMockServer({ models: ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini'] });
  const target = normalizeTarget({ name: 'mock', base_url: `${server.baseUrl}/v1`, model: 'deepseek-chat', api_key: 'sk-model-test' });
  await store.writeTargets([target]);
  t.after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const discovered = await api.discoverModels({ targetId: target.id });
  assert.deepEqual(discovered.models, ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini']);
  assert.ok(discovered.latency_ms >= 0);
  assert.equal(discovered.base_url, `${server.baseUrl}/v1`);

  const noAuthServer = await startMockServer({ models: ['x'], authRequired: true });
  await assert.rejects(() => api.discoverModels({ baseUrl: `${noAuthServer.baseUrl}/v1`, apiKey: '' }), /鉴权失败|401/);
  await noAuthServer.close();
  await assert.rejects(() => api.discoverModels({ baseUrl: 'not a url' }), /合法地址|Base URL/);
});

test('custom plan from JSONL maps rows into custom dimension', async (t) => {
  const ctx = await setupPlan();
  const file = join(ctx.dir, 'custom.jsonl');
  await writeFile(file, [
    JSON.stringify({ id: 'c1', prompt: '只输出 2+2 的结果', expected: '4' }),
    JSON.stringify({ id: 'c2', prompt: '只输出 3+3 的结果', expected: '6' }),
    JSON.stringify({ id: 'c3', prompt: '只输出 5+5 的结果', expected: '10' }),
  ].join('\n'), 'utf8');
  t.after(() => ctx.cleanup());
  const plan = {
    plan_id: 'custom',
    target_a: ctx.targets[0].id,
    dataset: { source: 'file', file_path: file },
    dimensions: ['custom'],
    max_tokens: 32,
  };
  const run = await ctx.api.startPlan({ plan });
  const finished = await waitForRun(ctx.planManager, run.run_id);
  assert.equal(finished.status, 'completed', finished.error);
  assert.ok(finished.summary.dimensions.custom);
  assert.equal(finished.summary.dimensions.custom.items, 3);
});

test('estimatePlan counts requests and tokens', () => {
  const items = buildPlanItems('capability-spot');
  const estimate = estimatePlan(items, { targets: 2, maxTokens: 64 });
  assert.ok(estimate.requests >= items.length * 2);
  assert.ok(estimate.inputTokens > 0);
  assert.ok(estimate.outputTokens > 0);
});