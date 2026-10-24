/**
 * Metrics core — faithful port of EvalScope `perf/utils/benchmark_util.py`,
 * `perf/utils/db_util.py` (percentiles) and `perf/utils/perf_constants.py`.
 *
 * Layer 1  BenchmarkSample   — one request/response cycle, mirrors BenchmarkData
 * Layer 2  MetricsAccumulator — running totals, mirrors MetricsAccumulator
 * Layer 3  derived summaries  — mirrors BenchmarkMetrics + PercentileResult
 *
 * Conventions kept from the original:
 *   - every timestamp is seconds on a monotonic clock (`perf_counter` == performance.now()/1000)
 *   - average latency/TTFT/TPOT use seconds internally, and are reported in ms by the UI layer
 *   - missing / not-applicable values use the sentinel -1 (the UI renders "—" / "缺失")
 *   - warmup samples never enter any metric
 *   - TTFT/TPOT/ITL use stream-only denominators; pure non-stream runs fall back to all rows
 *   - percentiles are nearest-rank (NOT linear interpolation), matching EvalScope
 */

export const PERCENTILE_POINTS = [1, 5, 10, 25, 50, 75, 90, 95, 99];
export const PERCENTILE_LABELS = ['min', ...PERCENTILE_POINTS.map((p) => `${p}%`), 'max'];

/** Nearest-rank percentile, identical to EvalScope `calculate_percentiles`. */
export function nearestRank(sortedValues, percentile) {
  const n = sortedValues.length;
  if (n === 0) return Number.NaN;
  if (percentile >= 100) return sortedValues[n - 1];
  const index = Math.max(0, Math.ceil((n * percentile) / 100) - 1);
  return sortedValues[index];
}

/** Round to 4 decimals, like EvalScope's percentile rounding. */
export function round4(value) {
  return Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value;
}

export function computePercentiles(values, points = [0, ...PERCENTILE_POINTS, 100]) {
  const cleaned = values.filter((v) => Number.isFinite(v));
  const sorted = [...cleaned].sort((a, b) => a - b);
  const out = {};
  for (const p of points) out[p] = round4(nearestRank(sorted, p));
  return out;
}

/** Create an empty sample. Mirrors `BenchmarkData` defaults. */
export function createSample() {
  return {
    request: '',
    startTime: 0,
    completedTime: 0,
    chunkTimes: [],
    success: false,
    isStream: false,
    queryLatency: 0,
    firstChunkLatency: 0,
    timePerOutputToken: 0,
    interChunkLatency: [],
    generatedText: '',
    error: null,
    statusCode: null,
    promptTokens: null,
    completionTokens: null,
    tokenSource: null,
    cachedTokens: null,
    reportedModel: '',
    systemFingerprint: '',
    finishReason: null,
    nDecodeChunks: 0,
    decodedTokensPerIter: 0,
    isWarmup: false,
    requestId: null,
  };
}

/**
 * Rough token estimate used only when the endpoint returns no `usage`.
 * CJK characters count as ~1 token, other characters as ~0.25 token.
 * The estimate is always labelled `tokenSource: 'estimate'`; the workbench never
 * silently presents it as a server-reported count.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

/**
 * Derive timing metrics for one sample. Mirrors `BenchmarkData.finalize`:
 *   TPOT = (latency - TTFT) / (completion_tokens - 1)
 *   decoded tokens per iter = (tokens - 1) / (decode chunks - 1)
 * Idempotent, exactly like the original.
 */
export function finalizeSample(sample, options = {}) {
  if (sample.promptTokens == null || sample.completionTokens == null) {
    const promptText = options.promptText || '';
    if (!options.hasUsage) {
      sample.promptTokens = estimateTokens(promptText);
      sample.completionTokens = estimateTokens(sample.generatedText);
      sample.tokenSource = sample.tokenSource || 'estimate';
    }
  }

  if (sample.completionTokens && sample.completionTokens > 1) {
    sample.timePerOutputToken =
      (sample.queryLatency - sample.firstChunkLatency) / (sample.completionTokens - 1);
  }

  if (!sample.interChunkLatency.length && sample.chunkTimes.length > 1) {
    sample.interChunkLatency = [];
    for (let i = 1; i < sample.chunkTimes.length; i += 1) {
      sample.interChunkLatency.push(sample.chunkTimes[i] - sample.chunkTimes[i - 1]);
    }
  }

  const nChunks = sample.nDecodeChunks || sample.chunkTimes.length || sample.interChunkLatency.length + 1 || 0;
  if (sample.completionTokens && sample.completionTokens > 1 && nChunks > 1) {
    sample.decodedTokensPerIter = (sample.completionTokens - 1) / (nChunks - 1);
  }
  return sample;
}

/**
 * Running accumulator. Mirrors `MetricsAccumulator.update` / `to_result`.
 * One instance per sweep round (per concurrency / per rate), exactly like EvalScope.
 */
export class MetricsAccumulator {
  constructor({ concurrency = 0, rate = 0 } = {}) {
    this.concurrency = concurrency;
    this.rate = rate;
    this.nTotal = 0;
    this.nSuccess = 0;
    this.wallStart = null;
    this.wallEnd = null;
    this.totalLatency = 0;
    this.totalFirstChunkLatency = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTimePerOutputToken = 0;
    this.totalInterTokenLatency = 0;
    this.nInterTokenLatencies = 0;
    this.nStreamSuccess = 0;
    this.nStreamTotal = 0;
    this.nNonStreamTotal = 0;
    this.totalFirstChunkLatencyStream = 0;
    this.totalTimePerOutputTokenStream = 0;
    this.nStreamTpot = 0;
    this.totalDecodedTokensPerIter = 0;
    this.nDecodedSamples = 0;
  }

  get nFailed() {
    return this.nTotal - this.nSuccess;
  }

  get wallTime() {
    if (this.wallStart != null && this.wallEnd != null) {
      return Math.max(this.wallEnd - this.wallStart, 0);
    }
    return 1;
  }

  update(sample) {
    if (sample.isWarmup) return;
    this.nTotal += 1;
    if (sample.isStream) this.nStreamTotal += 1;
    else this.nNonStreamTotal += 1;

    if (sample.success) {
      this.nSuccess += 1;
      finalizeSample(sample, { hasUsage: sample.tokenSource === 'usage' });
      this.totalLatency += sample.queryLatency;
      this.totalFirstChunkLatency += sample.firstChunkLatency;
      this.totalPromptTokens += sample.promptTokens || 0;
      this.totalCompletionTokens += sample.completionTokens || 0;
      this.totalTimePerOutputToken += sample.timePerOutputToken;
      this.totalInterTokenLatency += sample.interChunkLatency.reduce((a, b) => a + b, 0);
      this.nInterTokenLatencies += sample.interChunkLatency.length;
      if (sample.isStream) {
        this.nStreamSuccess += 1;
        this.totalFirstChunkLatencyStream += sample.firstChunkLatency;
        if (sample.completionTokens && sample.completionTokens > 1) {
          this.totalTimePerOutputTokenStream += sample.timePerOutputToken;
          this.nStreamTpot += 1;
        }
      }
      if (sample.decodedTokensPerIter > 1) {
        this.totalDecodedTokensPerIter += sample.decodedTokensPerIter;
        this.nDecodedSamples += 1;
      }
    }
    this.#updateWallTime(sample);
  }

  #updateWallTime(sample) {
    if (!(sample.startTime > 0) || sample.completedTime < sample.startTime) return;
    this.wallStart = this.wallStart == null ? sample.startTime : Math.min(this.wallStart, sample.startTime);
    this.wallEnd = this.wallEnd == null ? sample.completedTime : Math.max(this.wallEnd, sample.completedTime);
  }

  toResult() {
    const n = this.nSuccess;
    const t = this.wallTime;
    const safeDiv = (num, den, fallback = -1) => (den ? num / den : fallback);

    const avgLatency = safeDiv(this.totalLatency, n);
    let avgTtft;
    let avgTpot;
    if (this.nStreamSuccess > 0) {
      avgTtft = safeDiv(this.totalFirstChunkLatencyStream, this.nStreamSuccess);
      avgTpot = safeDiv(this.totalTimePerOutputTokenStream, this.nStreamTpot, 0);
    } else {
      avgTtft = safeDiv(this.totalFirstChunkLatency, n);
      avgTpot = safeDiv(this.totalTimePerOutputToken, n);
    }
    const avgPromptTokens = safeDiv(this.totalPromptTokens, n);
    const avgCompletionTokens = safeDiv(this.totalCompletionTokens, n);
    const avgItl = this.nInterTokenLatencies ? this.totalInterTokenLatency / this.nInterTokenLatencies : 0;
    const qps = safeDiv(n, t);
    const outputTokenThroughput = safeDiv(this.totalCompletionTokens, t);
    const totalTokenThroughput = safeDiv(this.totalPromptTokens + this.totalCompletionTokens, t);
    const inputTokenThroughput = safeDiv(this.totalPromptTokens, this.totalFirstChunkLatency);
    const avgDecodedTokensPerIter = this.nDecodedSamples ? this.totalDecodedTokensPerIter / this.nDecodedSamples : -1;

    return {
      concurrency: this.concurrency,
      rate: this.rate,
      total_requests: this.nTotal,
      succeed_requests: this.nSuccess,
      failed_requests: this.nFailed,
      stream_requests: this.nStreamTotal,
      non_stream_requests: this.nNonStreamTotal,
      total_time: t,
      avg_latency: avgLatency,
      avg_ttft: avgTtft,
      avg_tpot: avgTpot,
      avg_itl: avgItl,
      qps,
      avg_prompt_tokens: avgPromptTokens,
      avg_completion_tokens: avgCompletionTokens,
      input_token_throughput: inputTokenThroughput,
      output_token_throughput: outputTokenThroughput,
      total_token_throughput: totalTokenThroughput,
      success_rate: safeDiv(this.nSuccess * 100, this.nTotal, 0),
      avg_decoded_tokens_per_iter: avgDecodedTokensPerIter,
      // --- additions of this workbench (not in EvalScope) ---
      requests_per_minute: qps > 0 ? qps * 60 : -1,
      output_tokens_per_minute: outputTokenThroughput > 0 ? outputTokenThroughput * 60 : -1,
      total_tokens_per_minute: totalTokenThroughput > 0 ? totalTokenThroughput * 60 : -1,
      wall_start: this.wallStart,
      wall_end: this.wallEnd,
    };
  }
}

/**
 * Percentile table. Mirrors `get_percentile_results`: the same metric columns,
 * the same stream-only bucketing and the same nearest-rank percentiles.
 */
export function buildPercentileTable(samples) {
  const success = samples.filter((s) => s.success && !s.isWarmup);
  const streamSuccess = success.filter((s) => s.isStream);
  const streaming = streamSuccess.length ? streamSuccess : success;

  const itl = [];
  for (const s of success) itl.push(...s.interChunkLatency.map((v) => v * 1000));

  const metrics = {
    'TTFT (ms)': streaming.map((s) => s.firstChunkLatency * 1000),
    'ITL (ms)': itl,
    'TPOT (ms)': streaming.map((s) => (s.timePerOutputToken > 0 || !streamSuccess.length ? s.timePerOutputToken * 1000 : Number.NaN)),
    'Decode (tok/s)': streaming.map((s) => (s.timePerOutputToken > 0 ? 1 / s.timePerOutputToken : Number.NaN)),
    'Latency (s)': success.map((s) => s.queryLatency),
    'Input tokens': success.map((s) => s.promptTokens ?? Number.NaN),
    'Output tokens': success.map((s) => s.completionTokens ?? Number.NaN),
    'Output (tok/s)': success.map((s) => (s.queryLatency > 0 ? (s.completionTokens || 0) / s.queryLatency : Number.NaN)),
    'Total (tok/s)': success.map((s) =>
      s.queryLatency > 0 ? ((s.promptTokens || 0) + (s.completionTokens || 0)) / s.queryLatency : Number.NaN,
    ),
  };

  const columns = {};
  for (const [name, values] of Object.entries(metrics)) {
    const pct = computePercentiles(values);
    columns[name] = [...PERCENTILE_POINTS.map((p) => pct[p]), pct[0], pct[100]];
  }
  return {
    percentiles: [...PERCENTILE_POINTS.map((p) => `${p}%`), 'min', 'max'],
    columns,
  };
}

/**
 * Sample-count metadata, so the UI can show "n" next to every aggregate
 * (EvalScope's `_summary_sample_counts` equivalent).
 */
export function summarySampleCounts(summary) {
  const streamSuccess = summary.stream_requests > 0 ? Math.min(summary.succeed_requests, summary.stream_requests) : summary.succeed_requests;
  const generated = streamSuccess > 0 ? streamSuccess : summary.succeed_requests;
  return {
    request_throughput: summary.succeed_requests,
    avg_latency: summary.succeed_requests,
    avg_ttft: generated,
    avg_tpot: generated,
    avg_itl: generated,
    output_token_throughput: summary.succeed_requests,
    success_rate: summary.total_requests,
  };
}