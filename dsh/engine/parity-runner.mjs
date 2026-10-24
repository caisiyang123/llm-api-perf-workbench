/**
 * Consistency / quality run manager.
 *
 * A parity run sends the same prompt to two configured targets (A and B) and
 * records both answers locally, then scores:
 *   - pair similarity (exact / normalised / edit / trigram / usage / structure)
 *   - gold checks when the prompt set carries expected answers
 *   - optional LLM-as-judge verdicts, with an order-swapped second call to
 *     expose position bias.
 *
 * Deliberately separate from the load-test runner: the load-test runner never
 * persists answer text, and the two have different safety limits. Both share
 * the same store (`runs/<id>/meta.json`) and differ by `kind`.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { postOnce, createHttpAgent } from './http.mjs';
import { resolveEndpointUrl, buildHeaders } from './runner.mjs';
import {
  PARITY_LIMITS,
  loadParityPrompts,
  pairMetrics,
  aggregateParity,
  aggregateQuality,
  goldChecks,
  buildJudgeMessages,
  parseJudgeOutput,
  judgeBodies,
} from './parity.mjs';

export const PARITY_PLAN_DEFAULTS = {
  repeats: 1,
  temperature: 0,
  seed: 42,
  max_tokens: 256,
  judge: { enabled: false, target_id: null, rubric: '', swap: true },
};

const ANSWER_TEXT_LIMIT = 20000;

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function snapshotTarget(target) {
  return {
    id: target.id,
    name: target.name,
    model: target.model,
    endpoint: target.endpoint === 'completions' ? 'completions' : 'chat',
    host: (() => {
      try {
        return new URL(target.base_url).host;
      } catch {
        return '';
      }
    })(),
  };
}

export function sanitizeParityPlan(plan, targets) {
  if (!plan || typeof plan !== 'object') throw new Error('缺少一致性校验参数');
  const targetA = targets.find((item) => item.id === plan.target_a);
  const targetB = targets.find((item) => item.id === plan.target_b);
  if (!targetA) throw new Error('请选择目标 A（基准端点）');
  if (!targetB) throw new Error('请选择目标 B（待核对端点）');
  if (targetA.id === targetB.id) throw new Error('目标 A 与目标 B 不能是同一个端点');
  const source = ['builtin', 'file'].includes(plan.dataset?.source) ? plan.dataset.source : 'builtin';
  if (source === 'file' && !plan.dataset?.file_path) throw new Error('file 提示词集需要提供 JSONL 文件路径');
  const repeats = clampInt(plan.repeats, 1, PARITY_LIMITS.maxRepeats, PARITY_PLAN_DEFAULTS.repeats);
  const judgeEnabled = plan.judge?.enabled === true;
  const judgeTarget = judgeEnabled ? targets.find((item) => item.id === plan.judge?.target_id) : null;
  if (judgeEnabled && !judgeTarget) throw new Error('启用了 LLM 评审，但未选择有效的评审目标');
  const swap = plan.judge?.swap !== false;
  return {
    target_a: targetA.id,
    target_b: targetB.id,
    targets: { a: snapshotTarget(targetA), b: snapshotTarget(targetB) },
    dataset: {
      source,
      file_path: plan.dataset?.file_path ? String(plan.dataset.file_path) : '',
    },
    repeats,
    temperature: clampNumber(plan.temperature, 0, 2, PARITY_PLAN_DEFAULTS.temperature),
    seed: plan.seed == null || plan.seed === '' ? PARITY_PLAN_DEFAULTS.seed : clampInt(plan.seed, 0, 2 ** 31 - 1, PARITY_PLAN_DEFAULTS.seed),
    max_tokens: clampInt(plan.max_tokens, 16, PARITY_LIMITS.maxTokens, PARITY_PLAN_DEFAULTS.max_tokens),
    judge: {
      enabled: judgeEnabled,
      target_id: judgeTarget ? judgeTarget.id : null,
      target: judgeTarget ? snapshotTarget(judgeTarget) : null,
      rubric: typeof plan.judge?.rubric === 'string' ? plan.judge.rubric.slice(0, 500) : '',
      swap,
      self_judging: Boolean(judgeTarget && (judgeTarget.id === targetA.id || judgeTarget.id === targetB.id)),
    },
    timeouts: {
      total_ms: clampInt(plan.timeouts?.total_ms, 5000, 600000, 180000),
      connect_ms: clampInt(plan.timeouts?.connect_ms, 100, 60000, 15000),
      read_ms: clampInt(plan.timeouts?.read_ms, 1000, 300000, 120000),
    },
  };
}

export function parityRequest({ target, prompt, maxTokens, temperature, seed }) {
  const requestSeed = seed == null ? {} : { seed };
  if (target.endpoint === 'completions') {
    return {
      url: resolveEndpointUrl(target),
      headers: buildHeaders(target),
      body: { model: target.model, prompt, max_tokens: maxTokens, temperature, ...requestSeed, stream: false },
      promptText: prompt,
    };
  }
  return {
    url: resolveEndpointUrl(target),
    headers: buildHeaders(target),
    body: {
      model: target.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
      ...requestSeed,
      stream: false,
    },
    promptText: prompt,
  };
}

function answerOf(sample) {
  const text = String(sample.generatedText || '');
  return {
    success: sample.success === true,
    text: text.slice(0, ANSWER_TEXT_LIMIT),
    truncated: text.length > ANSWER_TEXT_LIMIT,
    latency_ms: Math.round(sample.queryLatency * 1000),
    status_code: sample.statusCode,
    token_source: sample.tokenSource,
    usage: {
      prompt_tokens: sample.promptTokens,
      completion_tokens: sample.completionTokens,
    },
    error: sample.error ? String(sample.error).slice(0, 300) : null,
  };
}

function judgeRequest(target, messages, rubric) {
  const body = target.endpoint === 'completions'
    ? {
        model: target.model,
        prompt: messages.map((message) => `${message.role}: ${message.content}`).join('\n\n'),
        max_tokens: 400,
        temperature: 0,
        stream: false,
      }
    : { model: target.model, messages, max_tokens: 400, temperature: 0, stream: false };
  return {
    url: resolveEndpointUrl(target),
    headers: buildHeaders(target),
    body,
    promptText: rubric ? `judge:${rubric}` : 'judge',
  };
}

export function differenceRows(rows, limit = 10) {
  return [...rows]
    .filter((row) => row?.metrics && row.a?.success !== false && row.b?.success !== false)
    .sort((left, right) => (left.metrics.edit ?? 1) - (right.metrics.edit ?? 1))
    .slice(0, limit)
    .map((row) => ({
      prompt_id: row.prompt_id,
      repeat: row.repeat,
      exact: Boolean(row.metrics.exact),
      normalized: Boolean(row.metrics.normalized),
      edit: row.metrics.edit,
      jaccard: row.metrics.jaccard,
      length_ratio: row.metrics.length_ratio,
      judge_winner: row.judge?.verdict?.winner || null,
      prompt: String(row.prompt || '').slice(0, 200),
      answer_a: String(row.a?.text || '').slice(0, 500),
      answer_b: String(row.b?.text || '').slice(0, 500),
    }));
}

export class ParityManager {
  constructor({ store, onProgress }) {
    this.store = store;
    this.onProgress = onProgress || (() => {});
    this.runs = new Map();
    this.cancelled = new Set();
    this.active = null;
  }

  async initialize() {
    const runs = await this.store.listRuns();
    for (const run of runs) {
      if (run.kind !== 'parity') continue;
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = '进程退出导致本次一致性校验中断。';
        await this.store.writeRun(run);
      }
      this.runs.set(run.id, run);
    }
  }

  list() {
    return [...this.runs.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  get(runId) {
    return this.runs.get(runId) || null;
  }

  cancel(runId) {
    if (!this.runs.has(runId)) throw new Error('未找到该一致性校验运行');
    this.cancelled.add(runId);
    const run = this.runs.get(runId);
    if (run) run.status = run.status === 'running' ? 'cancelling' : run.status;
    return { cancelled: true };
  }

  async start(planInput, targets, options = {}) {
    const plan = sanitizeParityPlan(planInput, targets);
    let prompts;
    if (plan.dataset.source === 'file') {
      let content;
      try {
        content = await readFile(plan.dataset.file_path, 'utf8');
      } catch (error) {
        throw new Error(`读取提示词文件失败：${error.message}`);
      }
      prompts = loadParityPrompts({ source: 'file', fileContent: content });
    } else {
      prompts = loadParityPrompts({ source: 'builtin' });
    }
    const pairs = prompts.length * plan.repeats;
    const judgeCalls = plan.judge.enabled ? pairs * (plan.judge.swap ? 2 : 1) : 0;
    if (judgeCalls > PARITY_LIMITS.maxJudgeCalls) {
      throw new Error(`本次计划需要 ${judgeCalls} 次评审调用，超过上限 ${PARITY_LIMITS.maxJudgeCalls}；请减少提示词、重复次数，或关闭评审顺序互换`);
    }

    const targetA = targets.find((item) => item.id === plan.target_a);
    const targetB = targets.find((item) => item.id === plan.target_b);
    const judgeTarget = plan.judge.enabled ? targets.find((item) => item.id === plan.judge.target_id) : null;

    const run = {
      id: randomUUID(),
      kind: 'parity',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'running',
      session_id: options.sessionId || null,
      plan,
      prompt_count: prompts.length,
      pair_count: pairs,
      progress: { total_pairs: pairs, completed_pairs: 0, failed_pairs: 0, judge_calls: 0 },
      summary: null,
      error: null,
    };
    this.runs.set(run.id, run);
    await this.store.writeRun(run);
    this.onProgress(run);

    const execution = this.#execute(run, { targetA, targetB, judgeTarget, prompts, plan }).catch(async (error) => {
      run.status = 'failed';
      run.error = error.message;
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);
    });
    this.active = execution;
    return run;
  }

  async #execute(run, { targetA, targetB, judgeTarget, prompts, plan }) {
    const agentA = createHttpAgent({ concurrency: 1, protocol: new URL(resolveEndpointUrl(targetA)).protocol });
    const agentB = createHttpAgent({ concurrency: 1, protocol: new URL(resolveEndpointUrl(targetB)).protocol });
    const judgeProtocol = judgeTarget ? new URL(resolveEndpointUrl(judgeTarget)).protocol : 'https:';
    const agentJudge = judgeTarget ? createHttpAgent({ concurrency: 1, protocol: judgeProtocol }) : null;
    const rows = [];

    try {
      for (const promptRow of prompts) {
        for (let repeat = 0; repeat < plan.repeats; repeat += 1) {
          if (this.cancelled.has(run.id)) throw Object.assign(new Error('运行已取消'), { cancelled: true });
          // Alternate which endpoint answers first so a shared upstream cache or
          // rate-limit tail cannot systematically favour B.
          const aFirst = repeat % 2 === 0;
          const callA = () => postOnce({
            ...parityRequest({ target: targetA, prompt: promptRow.prompt, maxTokens: plan.max_tokens, temperature: plan.temperature, seed: plan.seed }),
            agent: agentA,
            totalTimeoutMs: plan.timeouts.total_ms,
            connectTimeoutMs: plan.timeouts.connect_ms,
            readTimeoutMs: plan.timeouts.read_ms,
          });
          const callB = () => postOnce({
            ...parityRequest({ target: targetB, prompt: promptRow.prompt, maxTokens: plan.max_tokens, temperature: plan.temperature, seed: plan.seed }),
            agent: agentB,
            totalTimeoutMs: plan.timeouts.total_ms,
            connectTimeoutMs: plan.timeouts.connect_ms,
            readTimeoutMs: plan.timeouts.read_ms,
          });
          const firstSample = aFirst ? await callA() : await callB();
          const secondSample = aFirst ? await callB() : await callA();
          const answerA = answerOf(aFirst ? firstSample : secondSample);
          const answerB = answerOf(aFirst ? secondSample : firstSample);

          const row = {
            prompt_id: promptRow.id,
            prompt: promptRow.prompt,
            prompt_row: promptRow,
            repeat,
            order: aFirst ? 'A-first' : 'B-first',
            a: answerA,
            b: answerB,
            metrics: pairMetrics(answerA.text, answerB.text, answerA.usage, answerB.usage),
            judge: null,
          };
          row.gold_a = goldChecks(promptRow, answerA.text);
          row.gold_b = goldChecks(promptRow, answerB.text);

          if (answerA.success && answerB.success && judgeTarget) {
            row.judge = await this.#judge({
              judgeTarget,
              agent: agentJudge,
              promptRow,
              answerA: answerA.text,
              answerB: answerB.text,
              rubric: plan.judge.rubric || promptRow.rubric || '',
              swap: plan.judge.swap,
              timeouts: plan.timeouts,
            });
            run.progress.judge_calls += row.judge?.calls || 0;
          }

          rows.push(row);
          await this.store.appendParityRow(run.id, row);
          run.progress.completed_pairs += 1;
          if (!answerA.success || !answerB.success) run.progress.failed_pairs += 1;
          run.updated_at = new Date().toISOString();
          await this.store.writeRun(run);
          this.onProgress(run);
        }
      }

      const summary = {
        parity: aggregateParity(rows),
        quality: aggregateQuality(rows),
        diffs: differenceRows(rows),
        per_target: {
          a: { failures: rows.filter((row) => row.a.success === false).length, token_sources: countSources(rows, 'a') },
          b: { failures: rows.filter((row) => row.b.success === false).length, token_sources: countSources(rows, 'b') },
        },
      };
      run.summary = summary;
      run.status = this.cancelled.has(run.id) ? 'cancelled' : 'completed';
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);
    } catch (error) {
      run.status = error.cancelled || this.cancelled.has(run.id) ? 'cancelled' : 'failed';
      run.error = error.cancelled ? null : error.message;
      run.summary = run.summary || { parity: aggregateParity(rows), quality: aggregateQuality(rows), diffs: differenceRows(rows) };
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);
    } finally {
      agentA.destroy?.();
      agentB.destroy?.();
      agentJudge?.destroy?.();
      this.cancelled.delete(run.id);
    }
  }

  async #judge({ judgeTarget, agent, promptRow, answerA, answerB, rubric, swap, timeouts }) {
    const call = async (messages) => {
      const sample = await postOnce({
        ...judgeRequest(judgeTarget, messages, rubric),
        agent,
        totalTimeoutMs: timeouts.total_ms,
        connectTimeoutMs: timeouts.connect_ms,
        readTimeoutMs: timeouts.read_ms,
      });
      return { sample, verdict: sample.success ? parseJudgeOutput(sample.generatedText) : null };
    };
    const first = await call(buildJudgeMessages({ prompt: promptRow.prompt, answerA, answerB, rubric }));
    if (!first.verdict) {
      return {
        calls: 1,
        verdict: null,
        error: first.sample.error || '评审输出无法解析为 JSON',
        raw: String(first.sample.generatedText || '').slice(0, 500),
      };
    }
    // A judge that names a winner but gives that side a lower score is
    // self-contradictory; such rows must not decide a quality difference.
    const contradictory =
      (first.verdict.winner === 'A' && first.verdict.score_a < first.verdict.score_b)
      || (first.verdict.winner === 'B' && first.verdict.score_b < first.verdict.score_a);
    if (!swap) return { calls: 1, verdict: first.verdict, swap: null, consistent: null, contradictory };
    const second = await call(judgeBodies({ prompt: promptRow.prompt, answerA, answerB, rubric }, { swap: true }));
    const mirrored = second.verdict
      ? {
          ...second.verdict,
          winner: second.verdict.winner === 'A' ? 'B' : second.verdict.winner === 'B' ? 'A' : 'TIE',
        }
      : null;
    const consistent = mirrored ? mirrored.winner === first.verdict.winner : null;
    return {
      calls: 2,
      verdict: first.verdict,
      swap: mirrored,
      consistent,
      contradictory,
      error: second.sample.error || null,
    };
  }
}

function countSources(rows, key) {
  const counts = { usage: 0, estimate: 0, missing: 0 };
  for (const row of rows) {
    const source = row[key]?.token_source;
    if (source === 'usage') counts.usage += 1;
    else if (source === 'estimate') counts.estimate += 1;
    else counts.missing += 1;
  }
  return counts;
}