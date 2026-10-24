/**
 * 测试方案运行器（plan runs）。
 *
 * 与压测（kind: 'bench'）和 A/B 一致性（kind: 'parity'）并列，共用 runs/<id>/meta.json：
 *   runs/<id>/plan.ndjson  每题一行，含题目与回答原文（仅本机，0600）
 *
 * 一个 plan run = 选定的标准/定制方案 × 目标 A（必选）× 目标 B（可选参考）。
 * 每题的判定是程序化的（金标、格式约束、拒答启发式、检索命中）；LLM 评审只是附加信号。
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { postOnce, createHttpAgent } from './http.mjs';
import { resolveEndpointUrl, buildHeaders } from './runner.mjs';
import { pairMetrics } from './parity.mjs';
import {
  PLAN_LIMITS,
  DIMENSION_META,
  buildPlanItems,
  planChecks,
  aggregatePlanResults,
  planVerdicts,
  compareTargets,
  usageAudit,
  judgeSummary,
  planThresholds,
  buildPlanJudgeMessages,
  parsePlanJudge,
  estimatePlan,
  findPlan,
  customPlanItems,
} from './plans.mjs';
import { snapshotTarget } from './parity-runner.mjs';
import { billingAudit, mixAudit, costSummary } from './audits.mjs';

export const PLAN_RUN_DEFAULTS = {
  temperature: 0,
  seed: 42,
  max_tokens: 256,
  per_dimension: 0,
  repeats: 1,
  judge: { enabled: false, target_id: null, rubric: '' },
  long_context: { lengths: [4000, 16000], depths: ['front', 'middle', 'end'] },
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

export function sanitizePlanRun(input, targets) {
  if (!input || typeof input !== 'object') throw new Error('缺少测试方案参数');
  const planId = typeof input.plan_id === 'string' && input.plan_id ? input.plan_id : 'custom';
  const standard = findPlan(planId);
  if (planId !== 'custom' && (!standard || standard.engine !== 'plan')) {
    throw new Error(`方案 ${planId} 不是可直接执行的提示词方案；一致性/性能方案请使用对应页面`);
  }
  const targetA = targets.find((item) => item.id === input.target_a);
  if (!targetA) throw new Error('请选择目标 A（待测端点）');
  const targetB = input.target_b ? targets.find((item) => item.id === input.target_b) : null;
  if (input.target_b && !targetB) throw new Error('目标 B 不存在，请重新选择');
  if (targetB && targetB.id === targetA.id) throw new Error('目标 A 与目标 B 不能是同一个端点');
  const standardPlan = standard;
  if (standardPlan?.requires_b && !targetB) {
    throw new Error(`方案「${standardPlan.title}」需要目标 B（官方参考端点）；没有参照就无法判断 usage 是否虚高`);
  }

  const repeats = clampInt(input.repeats, 1, PLAN_LIMITS.maxRepeats, PLAN_RUN_DEFAULTS.repeats);
  const explicitTemperature = input.temperature != null && input.temperature !== '';
  let temperature = clampNumber(input.temperature, 0, 2, explicitTemperature ? PLAN_RUN_DEFAULTS.temperature : (standardPlan?.default_temperature ?? PLAN_RUN_DEFAULTS.temperature));
  let temperatureDefaulted = false;
  if (standardPlan?.id === 'mix-audit' && temperature === 0) {
    temperature = clampNumber(standardPlan.default_temperature, 0.1, 2, 0.7);
    temperatureDefaulted = true;
  }
  const pricingMode = input.pricing_mode === 'batch' ? 'batch' : 'standard';
  const judgeEnabled = input.judge?.enabled === true;
  const judgeTarget = judgeEnabled ? targets.find((item) => item.id === input.judge?.target_id) : null;
  if (judgeEnabled && !judgeTarget) throw new Error('启用了 LLM 评审，但未选择有效的评审目标');

  const dimensions = Array.isArray(input.dimensions)
    ? input.dimensions.filter((dimension) => Object.prototype.hasOwnProperty.call(DIMENSION_META, dimension))
    : [];
  const dataset = {
    source: ['builtin', 'file'].includes(input.dataset?.source) ? input.dataset.source : 'builtin',
    file_path: input.dataset?.file_path ? String(input.dataset.file_path) : '',
  };
  if (dataset.source === 'file' && !dataset.file_path) throw new Error('file 语料需要提供 JSONL 文件路径');

  const longContext = {
    lengths: (Array.isArray(input.long_context?.lengths) && input.long_context.lengths.length
      ? input.long_context.lengths
      : PLAN_RUN_DEFAULTS.long_context.lengths
    ).map((value) => clampInt(value, 1200, PLAN_LIMITS.maxContextChars, 4000)).slice(0, 4),
    depths: (Array.isArray(input.long_context?.depths) && input.long_context.depths.length
      ? input.long_context.depths
      : PLAN_RUN_DEFAULTS.long_context.depths
    ).filter((depth) => ['front', 'middle', 'end'].includes(depth)),
  };
  if (!longContext.depths.length) longContext.depths = [...PLAN_RUN_DEFAULTS.long_context.depths];

  return {
    plan_id: planId,
    title: planId === 'custom' ? '定制方案' : standard.title,
    dimensions: dimensions.length ? dimensions : (standard ? standard.dimensions : []),
    target_a: targetA.id,
    target_b: targetB ? targetB.id : null,
    targets: { a: snapshotTarget(targetA), ...(targetB ? { b: snapshotTarget(targetB) } : {}) },
    dataset,
    per_dimension: clampInt(input.per_dimension, 0, PLAN_LIMITS.maxPerDimension, PLAN_RUN_DEFAULTS.per_dimension),
    repeats,
    temperature,
    temperature_defaulted: temperatureDefaulted,
    pricing_mode: pricingMode,
    seed: input.seed == null || input.seed === '' ? PLAN_RUN_DEFAULTS.seed : clampInt(input.seed, 0, 2 ** 31 - 1, PLAN_RUN_DEFAULTS.seed),
    max_tokens: clampInt(input.max_tokens, 16, PLAN_LIMITS.maxTokens, PLAN_RUN_DEFAULTS.max_tokens),
    long_context: longContext,
    judge: {
      enabled: judgeEnabled,
      target_id: judgeTarget ? judgeTarget.id : null,
      target: judgeTarget ? snapshotTarget(judgeTarget) : null,
      rubric: typeof input.judge?.rubric === 'string' ? input.judge.rubric.slice(0, 500) : '',
      self_judging: Boolean(judgeTarget && (judgeTarget.id === targetA.id || (targetB && judgeTarget.id === targetB.id))),
    },
    thresholds: planThresholds(input.thresholds),
    timeouts: {
      total_ms: clampInt(input.timeouts?.total_ms, 5000, 900000, 240000),
      connect_ms: clampInt(input.timeouts?.connect_ms, 100, 60000, 15000),
      read_ms: clampInt(input.timeouts?.read_ms, 1000, 600000, 180000),
    },
  };
}

export function planRunRequest({ target, prompt, maxTokens, temperature, seed }) {
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
    prompt_tokens: sample.promptTokens,
    completion_tokens: sample.completionTokens,
    cached_tokens: sample.cachedTokens ?? null,
    reported_model: sample.reportedModel || '',
    system_fingerprint: sample.systemFingerprint || '',
    error: sample.error ? String(sample.error).slice(0, 300) : null,
  };
}

const CRITERIA_KEYS = [
  'expected_any', 'expected', 'expected_json', 'exact_text', 'must_include', 'must_include_any',
  'must_not_include', 'must_match_regex', 'forbid_regex', 'start_with', 'end_with',
  'max_chars', 'min_chars', 'max_lines', 'bullet_count', 'expect_refusal',
  'note', 'cache_probe', 'mix_strength',
];

function planCriteria(item) {
  const criteria = {};
  for (const key of CRITERIA_KEYS) {
    if (item[key] !== undefined) criteria[key] = item[key];
  }
  return criteria;
}

function judgeRequest(target, messages) {
  const body = target.endpoint === 'completions'
    ? {
        model: target.model,
        prompt: messages.map((message) => `${message.role}: ${message.content}`).join('\n\n'),
        max_tokens: 300,
        temperature: 0,
        stream: false,
      }
    : { model: target.model, messages, max_tokens: 300, temperature: 0, stream: false };
  return {
    url: resolveEndpointUrl(target),
    headers: buildHeaders(target),
    body,
    promptText: 'plan-judge',
  };
}

function stabilityOf(samples) {
  const texts = samples.filter((sample) => sample?.success && sample.text).map((sample) => sample.text);
  if (texts.length < 2) return { repeats: texts.length, stable: null, mean_edit: null };
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      total += pairMetrics(texts[i], texts[j], {}, {}).edit;
      pairs += 1;
    }
  }
  return { repeats: texts.length, stable: texts.every((text) => pairMetrics(text, texts[0], {}, {}).tight), mean_edit: pairs ? Math.round((total / pairs) * 1000) / 1000 : null };
}

export class PlanManager {
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
      if (run.kind !== 'plan') continue;
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = '进程退出导致本次测试方案中断。';
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
    if (!this.runs.has(runId)) throw new Error('未找到该测试方案运行');
    this.cancelled.add(runId);
    const run = this.runs.get(runId);
    if (run) run.status = run.status === 'running' ? 'cancelling' : run.status;
    return { cancelled: true };
  }

  async start(planInput, targets, options = {}) {
    const plan = sanitizePlanRun(planInput, targets);
    const standard = plan.plan_id === 'custom' ? null : findPlan(plan.plan_id);
    let items;
    if (plan.plan_id === 'custom' && plan.dataset.source === 'file') {
      let content;
      try {
        content = await readFile(plan.dataset.file_path, 'utf8');
      } catch (error) {
        throw new Error(`读取自定义语料失败：${error.message}`);
      }
      items = customPlanItems(content, 'custom');
    } else {
      items = buildPlanItems(plan.plan_id, {
        repeats: plan.repeats,
        per_dimension: plan.per_dimension,
        dimensions: plan.dimensions,
        long_context: plan.long_context,
      });
    }
    if (!items.length) throw new Error('方案没有可用题目');
    if (items.length > PLAN_LIMITS.maxItems) throw new Error(`本次方案包含 ${items.length} 道题，超过上限 ${PLAN_LIMITS.maxItems}`);
    const targetsInRun = plan.target_b ? 2 : 1;
    const requests = items.reduce((sum, item) => sum + (item.samples || 1), 0) * targetsInRun;
    const judgeCalls = plan.judge.enabled ? items.reduce((sum, item) => sum + (item.samples || 1), 0) * targetsInRun : 0;
    if (judgeCalls > PLAN_LIMITS.maxJudgeCalls) {
      throw new Error(`本次方案需要 ${judgeCalls} 次评审调用，超过上限 ${PLAN_LIMITS.maxJudgeCalls}；请减少题目、重复次数或关闭评审`);
    }

    const targetA = targets.find((item) => item.id === plan.target_a);
    const targetB = plan.target_b ? targets.find((item) => item.id === plan.target_b) : null;
    const judgeTarget = plan.judge.enabled ? targets.find((item) => item.id === plan.judge.target_id) : null;
    const estimate = estimatePlan(items, { targets: targetsInRun, maxTokens: plan.max_tokens });

    const run = {
      id: randomUUID(),
      kind: 'plan',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'running',
      session_id: options.sessionId || null,
      plan: {
        ...plan,
        engine: 'plan',
        standard_title: standard ? standard.title : '定制方案',
        emphasis: standard ? standard.emphasis : '按用户选择的维度拼装',
        references: standard ? standard.references : [],
        item_count: items.length,
      },
      estimate,
      progress: { total_items: items.length, completed_items: 0, requests: 0, failed_requests: 0, judge_calls: 0 },
      summary: null,
      error: null,
    };
    this.runs.set(run.id, run);
    await this.store.writeRun(run);
    this.onProgress(run);

    const execution = this.#execute(run, { targetA, targetB, judgeTarget, items, plan }).catch(async (error) => {
      run.status = 'failed';
      run.error = error.message;
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);
    });
    this.active = execution;
    return run;
  }

  async #execute(run, { targetA, targetB, judgeTarget, items, plan }) {
    const agentA = createHttpAgent({ concurrency: 1, protocol: new URL(resolveEndpointUrl(targetA)).protocol });
    const agentB = targetB ? createHttpAgent({ concurrency: 1, protocol: new URL(resolveEndpointUrl(targetB)).protocol }) : null;
    const agentJudge = judgeTarget ? createHttpAgent({ concurrency: 1, protocol: new URL(resolveEndpointUrl(judgeTarget)).protocol }) : null;
    const rows = [];
    const timeoutOptions = {
      totalTimeoutMs: plan.timeouts.total_ms,
      connectTimeoutMs: plan.timeouts.connect_ms,
      readTimeoutMs: plan.timeouts.read_ms,
    };
    const judgeBudget = () => PLAN_LIMITS.maxJudgeCalls - run.progress.judge_calls;

    const callTarget = async (target, agent, item, attempt) => {
      if (this.cancelled.has(run.id)) throw Object.assign(new Error('运行已取消'), { cancelled: true });
      const prompt = item.prompt;
      const sample = await postOnce({
        ...planRunRequest({ target, prompt, maxTokens: plan.max_tokens, temperature: plan.temperature, seed: plan.seed }),
        agent,
        ...timeoutOptions,
      });
      run.progress.requests += 1;
      let judge = null;
      if (!sample.success) run.progress.failed_requests += 1;
      if (plan.judge.enabled && judgeTarget && sample.success && judgeBudget() > 0) {
        const messages = buildPlanJudgeMessages({
          item: { ...(item || {}), prompt },
          answer: sample.generatedText || '',
          rubric: plan.judge.rubric,
        });
        const judgeSample = await postOnce({ ...judgeRequest(judgeTarget, messages), agent: agentJudge, ...timeoutOptions });
        run.progress.judge_calls += 1;
        judge = {
          call_index: run.progress.judge_calls,
          success: judgeSample.success,
          ...(judgeSample.success ? parsePlanJudge(judgeSample.generatedText) : { score: null, correct: null, reason: '评审请求失败' }),
          error: judgeSample.error ? String(judgeSample.error).slice(0, 300) : null,
        };
      }
      return { ...answerOf(sample), attempt, judge };
    };

    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (this.cancelled.has(run.id)) throw Object.assign(new Error('运行已取消'), { cancelled: true });
        const samplesCount = Math.max(1, item.samples || 1);
        const aSamples = [];
        const bSamples = [];
        for (let attempt = 0; attempt < samplesCount; attempt += 1) {
          aSamples.push(await callTarget(targetA, agentA, item, attempt));
          if (targetB) bSamples.push(await callTarget(targetB, agentB, item, attempt));
        }

        const judgeFor = (samples) => samples.find((sample) => sample.judge)?.judge || null;
        const targetResult = (samples) => {
          const first = samples.find((sample) => sample.success) || samples[0];
          const checks = first ? planChecks(item, first.text) : { graded: false, pass: false, checks: [] };
          return {
            success: samples.some((sample) => sample.success),
            samples,
            graded: checks.graded && samples.some((sample) => sample.success),
            pass: checks.graded && samples.some((sample) => sample.success) && checks.pass,
            checks: checks.checks,
            stability: samplesCount > 1 ? stabilityOf(samples) : null,
            judge: judgeFor(samples),
          };
        };

        const row = {
          item_id: item.id,
          dimension: item.dimension || 'custom',
          prompt: item.prompt,
          prompt_row: planCriteria(item),
          approx_prompt_chars: item.prompt.length,
          samples_per_item: samplesCount,
          a: targetResult(aSamples),
          ...(targetB ? { b: targetResult(bSamples) } : {}),
        };
        rows.push(row);
        await this.store.appendPlanRow(run.id, row);
        run.progress.completed_items += 1;
        run.updated_at = new Date().toISOString();
        await this.store.writeRun(run);
        this.onProgress(run);
      }

      const targetKeys = targetB ? ['a', 'b'] : ['a'];
      const dimensions = aggregatePlanResults(rows, targetKeys);
      const verdicts = planVerdicts(dimensions, plan.thresholds);
      const comparison = targetB ? compareTargets(dimensions, verdicts) : null;
      const billing = plan.dimensions.includes('billing')
        ? billingAudit(rows, { pricingA: targetA.pricing, pricingB: targetB?.pricing, batch: plan.pricing_mode === 'batch', at: run.created_at })
        : null;
      const routing = plan.dimensions.includes('routing')
        ? mixAudit(rows, { temperature: plan.temperature, repeats: Math.max(3, plan.repeats) })
        : null;
      const costs = costSummary(rows, {
        targetKeys,
        pricingA: targetA.pricing,
        pricingB: targetB?.pricing,
        batch: plan.pricing_mode === 'batch',
        at: run.created_at,
      });
      const gradedDimensions = Object.keys(dimensions).length;
      const overallKeys = targetB ? ['a', 'b'] : ['a'];
      for (const key of overallKeys) {
        verdicts.overall[key] ??= { status: 'INSUFFICIENT', totalGraded: 0 };
        let status = verdicts.overall[key].status;
        if (!gradedDimensions) {
          if (billing) {
            status = { PASS: 'PASS', WARN: 'WARN', SUSPECT: 'FAIL' }[billing.status] || 'INSUFFICIENT';
          } else if (routing) {
            status = routing.status === 'NO_EVIDENCE' ? 'PASS' : routing.status === 'SUSPECT' ? 'WARN' : 'INSUFFICIENT';
          }
        } else {
          if (billing?.status === 'SUSPECT') status = 'FAIL';
          else if (billing?.status === 'WARN' && status === 'PASS') status = 'WARN';
          if (routing?.status === 'SUSPECT' && status === 'PASS') status = 'WARN';
        }
        verdicts.overall[key].status = status;
      }
      const failedItems = [];
      for (const row of rows) {
        for (const key of targetKeys) {
          const result = row[key];
          if (!result?.graded || result.pass) continue;
          failedItems.push({
            target: key,
            item_id: row.item_id,
            dimension: row.dimension,
            prompt: String(row.prompt).slice(0, 160),
            answer: String(result.samples?.find((sample) => sample.success)?.text || '').slice(0, 300),
            checks: (result.checks || []).filter((check) => !check.pass).map((check) => check.name),
          });
        }
      }
      failedItems.splice(20);
      run.summary = {
        plan_id: plan.plan_id,
        title: run.plan.standard_title,
        dimensions,
        verdicts,
        comparison,
        failed_items: failedItems,
        billing_audit: billing,
        routing_audit: routing,
        costs,
        pricing_mode: plan.pricing_mode,
        pricing_snapshot: {
          a: targetA.pricing || null,
          ...(targetB ? { b: targetB.pricing || null } : {}),
        },
        usage: {
          a: usageAudit(rows, 'a'),
          ...(targetB ? { b: usageAudit(rows, 'b') } : {}),
        },
        judge: {
          a: judgeSummary(rows, 'a'),
          ...(targetB ? { b: judgeSummary(rows, 'b') } : {}),
        },
        requests: run.progress.requests,
        failed_requests: run.progress.failed_requests,
        judge_calls: run.progress.judge_calls,
        token_source: {
          a: countSources(rows, 'a'),
          ...(targetB ? { b: countSources(rows, 'b') } : {}),
        },
        limits: {
          note: '样本为抽查；判定只针对本次题库与参数。',
          min_graded_total: plan.thresholds.minGradedTotal,
          pass: plan.thresholds.pass,
          warn: plan.thresholds.warn,
        },
      };
      run.status = this.cancelled.has(run.id) ? 'cancelled' : 'completed';
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);
    } catch (error) {
      run.status = error.cancelled || this.cancelled.has(run.id) ? 'cancelled' : 'failed';
      run.error = error.cancelled ? null : error.message;
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);
    } finally {
      agentA.destroy?.();
      agentB?.destroy?.();
      agentJudge?.destroy?.();
      this.cancelled.delete(run.id);
    }
  }
}

function countSources(rows, key) {
  const counts = {};
  for (const row of rows) {
    for (const sample of row[key]?.samples || []) {
      const source = sample.token_source || 'missing';
      counts[source] = (counts[source] || 0) + 1;
    }
  }
  return counts;
}