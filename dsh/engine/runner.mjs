/**
 * Run orchestration: sweep rounds, warmup, persistence, progress and analysis.
 *
 * Ported from EvalScope `perf/benchmark.py` (`run_benchmark`, `run_multi_benchmark`,
 * `collect_metrics`) and `perf/main.py`, plus the SLA auto-tune judgement that
 * EvalScope exposes as `--sla-auto-tune` (here expressed as an SLO filter over the
 * same closed-loop sweep, so the workbench reports "max concurrency within SLO"
 * without a second control loop).
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MetricsAccumulator, buildPercentileTable, summarySampleCounts } from './metrics.mjs';
import { composeRequests, parsePromptFile } from './dataset.mjs';
import { postOnce, createHttpAgent } from './http.mjs';
import { normalizePricing } from './pricing.mjs';
import { runClosedLoop, runOpenLoop, probeConnection } from './scheduler.mjs';

const nowSec = () => performance.now() / 1000;
const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

export const LIMITS = {
  maxRounds: 20,
  maxConcurrency: 2048,
  maxRate: 5000,
  maxNumber: 20000,
  maxTokens: 32768,
  maxRunRequests: 120000,
  maxDurationSec: 86400,
  maxWarmup: 5000,
};

export function normalizeTarget(input) {
  if (!input || typeof input !== 'object') throw new Error('目标配置不能为空');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('目标名称不能为空');
  const baseUrl = String(input.base_url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('接口地址必须以 http:// 或 https:// 开头');
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password) throw new Error('接口地址不能内嵌账号密码');
  const model = String(input.model || '').trim();
  if (!model) throw new Error('模型名称不能为空');
  const headers = {};
  if (input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)) {
    for (const [key, value] of Object.entries(input.headers)) {
      if (typeof value !== 'string') throw new Error(`请求头 ${key} 必须是字符串`);
      if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'api-key') continue;
      headers[key] = value;
    }
  }
  return {
    id: input.id || `tgt-${randomUUID().slice(0, 8)}`,
    name,
    base_url: baseUrl,
    model,
    api_key: input.api_key == null ? '' : String(input.api_key),
    headers,
    endpoint: input.endpoint === 'completions' ? 'completions' : 'chat',
    pricing: normalizePricing(input.pricing),
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    note: input.note ? String(input.note).slice(0, 500) : '',
  };
}

export function maskTarget(target) {
  const key = target.api_key || '';
  return {
    id: target.id,
    name: target.name,
    base_url: target.base_url,
    model: target.model,
    endpoint: target.endpoint,
    headers: Object.keys(target.headers || {}),
    has_api_key: key.length > 0,
    api_key_hint: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '',
    note: target.note || '',
    pricing: target.pricing || null,
    updated_at: target.updated_at,
    created_at: target.created_at,
  };
}

export function resolveEndpointUrl(target) {
  const base = target.base_url.replace(/\/+$/, '');
  if (/\/(chat\/completions|completions)$/.test(base)) return base;
  return `${base}/${target.endpoint === 'completions' ? 'completions' : 'chat/completions'}`;
}

export function buildHeaders(target) {
  const headers = { ...(target.headers || {}) };
  if (target.api_key) headers.authorization = `Bearer ${target.api_key}`;
  return headers;
}

function sanitizePlan(plan, target) {
  const mode = plan && plan.mode === 'open' ? 'open' : 'closed';
  const number = clampInt(plan?.number, 1, LIMITS.maxNumber, 30);
  const rawList = mode === 'open' ? plan?.rate : plan?.concurrency;
  const list = (Array.isArray(rawList) ? rawList : [mode === 'open' ? 2 : 1])
    .map((value) => clampInt(value, 1, mode === 'open' ? LIMITS.maxRate : LIMITS.maxConcurrency, 1))
    .slice(0, LIMITS.maxRounds);
  const warmup = Number(plan?.warmup);
  const maxTokens = clampInt(plan?.max_tokens, 1, LIMITS.maxTokens, 256);
  const durationSec =
    plan?.duration_sec == null || plan?.duration_sec === '' ? null : clampInt(plan.duration_sec, 5, LIMITS.maxDurationSec, null);

  const totalRequests = number * list.length;
  if (totalRequests > LIMITS.maxRunRequests) {
    throw new Error(`本次计划共 ${totalRequests} 条请求，超过单次运行上限 ${LIMITS.maxRunRequests}`);
  }

  return {
    mode,
    list,
    number,
    totalRequests,
    warmup: Number.isFinite(warmup) && warmup > 0 ? Math.min(warmup, LIMITS.maxWarmup) : 0,
    duration_sec: durationSec,
    sleep_between_rounds_sec: clampInt(plan?.sleep_between_rounds_sec, 0, 120, 2),
    rate_pacing: mode === 'closed' && Number(plan?.rate) > 0 ? Math.min(Number(plan.rate), LIMITS.maxRate) : -1,
    max_tokens: maxTokens,
    temperature: Number.isFinite(Number(plan?.temperature)) ? Math.max(0, Math.min(2, Number(plan.temperature))) : 0,
    top_p: plan?.top_p == null || plan?.top_p === '' ? null : Math.max(0, Math.min(1, Number(plan.top_p))),
    seed: plan?.seed == null || plan?.seed === '' ? null : clampInt(plan.seed, 0, 2 ** 31 - 1, null),
    stream: plan?.stream !== false,
    endpoint: plan?.endpoint === 'completions' ? 'completions' : 'chat',
    dataset: {
      source: ['builtin', 'random', 'file'].includes(plan?.dataset?.source) ? plan.dataset.source : 'builtin',
      random_tokens: clampInt(plan?.dataset?.random_tokens, 16, LIMITS.maxTokens, 512),
      file_path: plan?.dataset?.file_path ? String(plan.dataset.file_path) : '',
    },
    in_flight_multiplier: clampInt(plan?.in_flight_multiplier, 1, 8, 2),
    timeouts: {
      total_ms: clampInt(plan?.timeouts?.total_ms, 1000, 21600000, 21600000),
      connect_ms: clampInt(plan?.timeouts?.connect_ms, 100, 600000, 30000),
      read_ms: clampInt(plan?.timeouts?.read_ms, 100, 3600000, 180000),
    },
    slo: {
      p99_ttft_ms: plan?.slo?.p99_ttft_ms ? Number(plan.slo.p99_ttft_ms) : null,
      p99_latency_ms: plan?.slo?.p99_latency_ms ? Number(plan.slo.p99_latency_ms) : null,
      min_success_rate: plan?.slo?.min_success_rate ? Number(plan.slo.min_success_rate) : null,
    },
    target_snapshot: {
      id: target.id,
      name: target.name,
      base_url: target.base_url,
      model: target.model,
      endpoint: target.endpoint,
      streaming: plan?.stream !== false,
    },
  };
}

function warmupCountFor(warmup, number) {
  if (!(warmup > 0)) return 0;
  if (warmup >= 1) return Math.trunc(warmup);
  return Math.max(1, Math.trunc(warmup * number));
}

function roundKeyFor(mode, value, number) {
  return mode === 'open' ? `rate_${value}_number_${number}` : `parallel_${value}_number_${number}`;
}

function pickPercentile(percentiles, metric, label) {
  const index = percentiles.percentiles.indexOf(label);
  if (index < 0) return null;
  const column = percentiles.columns[metric];
  if (!column) return null;
  return column[index];
}

export function analyzeRounds(rounds, slo) {
  const usable = rounds.filter((round) => round.summary && round.summary.succeed_requests > 0);
  if (!usable.length) {
    return { bottleneck: { status: 'no_data', message: '没有成功样本，无法判断瓶颈。请检查目标连通性与鉴权。' }, slo: null };
  }
  const sorted = [...usable].sort((a, b) => (a.parallel ?? a.rate) - (b.parallel ?? b.rate));
  const peak = sorted.reduce((best, round) => (round.summary.qps > best.summary.qps ? round : best), sorted[0]);
  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  const saturated = peak !== last && last.summary.qps < peak.summary.qps * 0.98;
  const firstLatency = first.summary.avg_latency;
  const lastLatency = last.summary.avg_latency;
  const amplification = firstLatency > 0 ? lastLatency / firstLatency : null;

  let message;
  if (sorted.length === 1) {
    message = `只有一档负载（${peak.parallel ?? peak.rate}），无法判断饱和点；建议增加到至少 3 档并上探到吞吐不再增长。`;
  } else if (saturated) {
    message = `吞吐在 ${peak.parallel ?? peak.rate} ${peak.parallel ? '并发' : 'req/s 到达率'} 附近见顶（${peak.summary.qps.toFixed(2)} req/s），之后回落；该点之前是可用区间，需结合 P99 与成功率决定可承载并发。`;
  } else {
    message = `吞吐仍在上升（末档 ${last.summary.qps.toFixed(2)} req/s），尚未触顶；结论只能是「至少能承载 ${last.parallel ?? last.rate}」，不能据此声明最大并发。`;
  }

  const sloResult = evaluateSlo(sorted, slo);

  return {
    bottleneck: {
      status: saturated ? 'saturated' : sorted.length === 1 ? 'single_point' : 'rising',
      peak: {
        value: peak.parallel ?? peak.rate,
        dimension: peak.parallel ? 'concurrency' : 'rate',
        qps: peak.summary.qps,
        output_tps: peak.summary.output_token_throughput,
      },
      latency_amplification: amplification,
      message,
    },
    slo: sloResult,
  };
}

export function evaluateSlo(rounds, slo) {
  if (!slo || (!slo.p99_ttft_ms && !slo.p99_latency_ms && !slo.min_success_rate)) return null;
  const checks = [];
  for (const round of rounds) {
    const p99Ttft = pickPercentile(round.percentiles, 'TTFT (ms)', '99%');
    const p99LatencyMs = round.percentiles ? (pickPercentile(round.percentiles, 'Latency (s)', '99%') || 0) * 1000 : null;
    const success = round.summary.success_rate;
    const failures = [];
    if (slo.p99_ttft_ms && p99Ttft != null && p99Ttft > slo.p99_ttft_ms) failures.push(`P99 TTFT ${p99Ttft.toFixed(0)}ms > ${slo.p99_ttft_ms}ms`);
    if (slo.p99_latency_ms && p99LatencyMs != null && p99LatencyMs > slo.p99_latency_ms)
      failures.push(`P99 延迟 ${p99LatencyMs.toFixed(0)}ms > ${slo.p99_latency_ms}ms`);
    if (slo.min_success_rate != null && success < slo.min_success_rate) failures.push(`成功率 ${success.toFixed(1)}% < ${slo.min_success_rate}%`);
    checks.push({
      value: round.parallel ?? round.rate,
      dimension: round.parallel ? 'concurrency' : 'rate',
      ok: failures.length === 0,
      failures,
      p99_ttft_ms: p99Ttft,
      p99_latency_ms: p99LatencyMs,
      success_rate: success,
      qps: round.summary.qps,
    });
  }
  const passed = checks.filter((check) => check.ok);
  const bound = passed.length ? passed[passed.length - 1] : null;
  return {
    thresholds: slo,
    checks,
    max_within_slo: bound ? bound.value : null,
    max_within_slo_dimension: bound ? bound.dimension : null,
    goodput_qps: bound ? bound.qps : 0,
    message: bound
      ? `满足全部 SLO 的最高档位为 ${bound.value}（${bound.dimension === 'concurrency' ? '并发' : 'req/s 到达率'}），对应有效吞吐 ${bound.qps.toFixed(2)} req/s。`
      : '没有任何档位满足 SLO，服务在最小负载下已超标。',
  };
}

export class RunManager {
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
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = '进程退出导致本次运行中断。';
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

  async resolveTargets() {
    return this.store.readTargets();
  }

  async testConnection(target) {
    const url = resolveEndpointUrl(target);
    const headers = buildHeaders(target);
    const agent = createHttpAgent({ concurrency: 1, protocol: new URL(url).protocol });
    try {
      const sample = await probeConnection({
        sendRequest: () =>
          postOnce({
            url,
            headers,
            body: {
              model: target.model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 8,
              stream: false,
            },
            promptText: 'ping',
            agent,
            totalTimeoutMs: 30000,
            connectTimeoutMs: 15000,
            readTimeoutMs: 30000,
          }),
      });
      return {
        ok: sample.success === true,
        latency_ms: sample.queryLatency * 1000,
        ttft_ms: sample.isStream ? sample.firstChunkLatency * 1000 : null,
        error: sample.error || null,
        status_code: sample.statusCode,
        model_reported: target.model,
      };
    } finally {
      agent.destroy();
    }
  }

  cancel(runId) {
    if (!this.runs.has(runId)) throw new Error('未找到该运行');
    this.cancelled.add(runId);
    return { cancelled: true };
  }

  async start(planInput, target, options = {}) {
    const plan = sanitizePlan(planInput, target);
    if (plan.dataset.source === 'file') {
      if (!plan.dataset.file_path) throw new Error('file 数据集需要提供 JSONL 文件路径');
      let content;
      try {
        content = await readFile(plan.dataset.file_path, 'utf8');
      } catch (error) {
        throw new Error(`读取提示词文件失败：${error.message}`);
      }
      plan._filePrompts = parsePromptFile(content);
    }

    const run = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'running',
      session_id: options.sessionId || null,
      plan,
      target: plan.target_snapshot,
      rounds: [],
      analysis: null,
      progress: { total_rounds: plan.list.length, current_round: 0, completed: 0, failed: 0, dispatched: 0 },
      error: null,
    };
    delete plan._filePrompts;
    this.runs.set(run.id, run);
    await this.store.writeRun(run);
    this.onProgress(run);

    const execution = this.#execute(run, target, planInput).catch(async (error) => {
      run.status = 'failed';
      run.error = error.message;
      run.updated_at = new Date().toISOString();
      delete run.progress;
      await this.store.writeRun(run);
      this.onProgress(run);
    });
    this.active = execution;
    return run;
  }

  async #execute(run, target, planInput) {
    const plan = sanitizePlan(planInput, target);
    const filePrompts = plan.dataset.source === 'file' ? parsePromptFile(await readFile(plan.dataset.file_path, 'utf8')) : [];
    const url = resolveEndpointUrl(target);
    const headers = buildHeaders(target);

    for (let roundIndex = 0; roundIndex < plan.list.length; roundIndex += 1) {
      if (this.cancelled.has(run.id)) break;
      const value = plan.list[roundIndex];
      const warmupCount = warmupCountFor(plan.warmup, plan.number, plan.mode);
      const requests = composeRequests({
        count: plan.number,
        warmupCount,
        source: plan.dataset.source,
        filePrompts,
        randomTokens: plan.dataset.random_tokens,
        params: {
          model: target.model,
          maxTokens: plan.max_tokens,
          temperature: plan.temperature,
          topP: plan.top_p,
          seed: plan.seed,
          stream: plan.stream,
          endpoint: plan.endpoint,
        },
      });

      const round = {
        key: roundKeyFor(plan.mode, value, plan.number),
        parallel: plan.mode === 'closed' ? value : null,
        rate: plan.mode === 'closed' ? plan.rate_pacing : value,
        number: plan.number,
        warmup: warmupCount,
        started_at: new Date().toISOString(),
        finished_at: null,
        summary: null,
        percentiles: null,
        sample_counts: null,
        token_sources: null,
        error: null,
        cancelled: false,
      };
      run.rounds.push(round);
      run.progress = {
        total_rounds: plan.list.length,
        current_round: roundIndex + 1,
        completed: 0,
        failed: 0,
        dispatched: 0,
        round_key: round.key,
        started_at: round.started_at,
      };
      this.onProgress(run);

      const agent = createHttpAgent({
        concurrency: plan.mode === 'closed' ? Math.max(2, value) : Math.min(512, Math.max(16, value * 2)),
        protocol: new URL(url).protocol,
      });
      const accumulator = new MetricsAccumulator({
        concurrency: plan.mode === 'closed' ? value : 0,
        rate: plan.mode === 'closed' ? plan.rate_pacing : value,
      });
      const samples = [];
      let persisted = [];
      let flushChain = Promise.resolve();
      const flush = () => {
        if (!persisted.length) return flushChain;
        const batch = persisted;
        persisted = [];
        flushChain = flushChain.then(async () => {
          for (const record of batch) {
            // eslint-disable-next-line no-await-in-loop
            await this.store.appendSample(run.id, record);
          }
        });
        return flushChain;
      };

      const sendRequest = (item) =>
        postOnce({
          url,
          headers,
          body: item.body,
          promptText: item.promptText,
          agent,
          totalTimeoutMs: plan.timeouts.total_ms,
          connectTimeoutMs: plan.timeouts.connect_ms,
          readTimeoutMs: plan.timeouts.read_ms,
        });

      const onSample = (sample) => {
        // Warmup rows are persisted as evidence but never enter metrics.
        if (!sample.isWarmup) accumulator.update(sample);
        if (samples.length < LIMITS.maxNumber * 2) samples.push(sample);
        if (!sample.isWarmup) {
          run.progress.completed = accumulator.nSuccess;
          run.progress.failed = accumulator.nFailed;
        }
        run.progress.dispatched += 1;
        persisted.push({
          round: round.key,
          is_warmup: Boolean(sample.isWarmup),
          start: Number(sample.startTime.toFixed(4)),
          latency_ms: Math.round(sample.queryLatency * 1e6) / 1e3,
          ttft_ms: Math.round(sample.firstChunkLatency * 1e6) / 1e3,
          tpot_ms: sample.timePerOutputToken > 0 ? Math.round(sample.timePerOutputToken * 1e6) / 1e3 : null,
          prompt_tokens: sample.promptTokens,
          completion_tokens: sample.completionTokens,
          token_source: sample.tokenSource,
          success: sample.success,
          status_code: sample.statusCode,
          error: sample.error ? String(sample.error).slice(0, 300) : null,
          is_stream: sample.isStream,
        });
        if (persisted.length >= 100) flush().catch(() => {});
      };

      let dispatchResult;
      try {
        if (plan.mode === 'open') {
          dispatchResult = await runOpenLoop({
            requests,
            sendRequest,
            onSample,
            rate: value,
            durationSec: plan.duration_sec,
            cancelled: () => this.cancelled.has(run.id),
          });
        } else {
          dispatchResult = await runClosedLoop({
            requests,
            sendRequest,
            onSample,
            parallel: value,
            rate: plan.rate_pacing,
            inFlightMultiplier: plan.in_flight_multiplier,
            durationSec: plan.duration_sec,
            cancelled: () => this.cancelled.has(run.id),
          });
        }
      } catch (error) {
        round.error = error.message;
      } finally {
        await flush().catch(() => {});
        agent.destroy();
      }

      round.finished_at = new Date().toISOString();
      round.dispatched = dispatchResult?.dispatched ?? 0;
      round.skipped = dispatchResult?.skipped ?? 0;
      round.cancelled = Boolean(dispatchResult?.stopped);
      round.summary = accumulator.toResult();
      round.percentiles = buildPercentileTable(samples);
      round.sample_counts = summarySampleCounts(round.summary);
      round.token_sources = samples.reduce(
        (acc, sample) => {
          if (sample.isWarmup) return acc;
          if (sample.tokenSource === 'usage') acc.usage += 1;
          else if (sample.tokenSource === 'estimate') acc.estimate += 1;
          else acc.missing += 1;
          return acc;
        },
        { usage: 0, estimate: 0, missing: 0 },
      );
      run.updated_at = new Date().toISOString();
      await this.store.writeRun(run);
      this.onProgress(run);

      if (this.cancelled.has(run.id)) break;
      if (roundIndex < plan.list.length - 1 && plan.sleep_between_rounds_sec > 0) {
        const end = nowSec() + plan.sleep_between_rounds_sec;
        while (nowSec() < end && !this.cancelled.has(run.id)) await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (this.cancelled.has(run.id) && run.status === 'running') {
      run.status = 'cancelled';
    } else if (run.status === 'running') {
      run.status = 'completed';
    }
    run.analysis = analyzeRounds(run.rounds, plan.slo);
    run.updated_at = new Date().toISOString();
    delete run.progress;
    await this.store.writeRun(run);
    this.onProgress(run);
    this.active = null;
  }
}