import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestRank,
  computePercentiles,
  createSample,
  estimateTokens,
  MetricsAccumulator,
  buildPercentileTable,
  summarySampleCounts,
} from '../dsh/engine/metrics.mjs';

test('nearest-rank percentiles match EvalScope semantics', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(nearestRank(values, 1), 1);
  assert.equal(nearestRank(values, 50), 50);
  assert.equal(nearestRank(values, 95), 95);
  assert.equal(nearestRank(values, 99), 99);
  assert.equal(nearestRank(values, 100), 100);
  assert.ok(Number.isNaN(nearestRank([], 50)));

  const pct = computePercentiles([5, 1, 3, 2, 4]);
  assert.equal(pct[0], 1);
  assert.equal(pct[50], 3);
  assert.equal(pct[100], 5);
});

test('estimateTokens is only a labelled fallback', () => {
  assert.equal(estimateTokens('你好世界'), 4);
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('accumulator reproduces EvalScope formulas', () => {
  const acc = new MetricsAccumulator({ concurrency: 2 });
  const mk = ({ start, latency, ttft, tokens, success = true, stream = true, warmup = false }) => {
    const sample = createSample();
    sample.startTime = start;
    sample.completedTime = start + latency;
    sample.queryLatency = latency;
    sample.firstChunkLatency = ttft;
    sample.promptTokens = 10;
    sample.completionTokens = tokens;
    sample.tokenSource = 'usage';
    sample.success = success;
    sample.isStream = stream;
    sample.isWarmup = warmup;
    sample.interChunkLatency = [0.01, 0.01];
    return sample;
  };

  acc.update(mk({ start: 100, latency: 2, ttft: 0.5, tokens: 100 }));
  acc.update(mk({ start: 101, latency: 2.5, ttft: 0.7, tokens: 120 }));
  acc.update(mk({ start: 100.5, latency: 3, ttft: 0.2, tokens: 0, success: false }));
  acc.update(mk({ start: 90, latency: 99, ttft: 90, tokens: 999, warmup: true }));

  const s = acc.toResult();
  assert.equal(s.total_requests, 3);
  assert.equal(s.succeed_requests, 2);
  assert.equal(s.failed_requests, 1);
  assert.ok(Math.abs(s.success_rate - 200 / 3) < 1e-9);
  assert.equal(s.total_time, 3.5);
  assert.ok(Math.abs(s.qps - 2 / 3.5) < 1e-12);
  assert.ok(Math.abs(s.output_token_throughput - 220 / 3.5) < 1e-12);
  assert.ok(Math.abs(s.total_token_throughput - 240 / 3.5) < 1e-12);
  assert.ok(Math.abs(s.avg_ttft - 0.6) < 1e-12);
  assert.ok(Math.abs(s.avg_latency - 2.25) < 1e-12);
  assert.ok(Math.abs(s.avg_tpot - (1.5 / 99 + 1.8 / 119) / 2) < 1e-12);
  assert.ok(Math.abs(s.avg_completion_tokens - 110) < 1e-12);
  assert.equal(s.requests_per_minute, (2 / 3.5) * 60);
  assert.equal(s.output_tokens_per_minute, (220 / 3.5) * 60);

  const counts = summarySampleCounts(s);
  assert.equal(counts.avg_ttft, 2);
});

test('percentile table uses stream-only denominators for TTFT/TPOT', () => {
  const stream1 = createSample();
  Object.assign(stream1, {
    success: true,
    isStream: true,
    startTime: 1,
    completedTime: 2,
    queryLatency: 1,
    firstChunkLatency: 0.1,
    promptTokens: 20,
    completionTokens: 50,
    tokenSource: 'usage',
    timePerOutputToken: (1 - 0.1) / 49,
    interChunkLatency: [0.02, 0.02],
  });
  const stream2 = createSample();
  Object.assign(stream2, {
    success: true,
    isStream: true,
    startTime: 2,
    completedTime: 4,
    queryLatency: 2,
    firstChunkLatency: 0.2,
    promptTokens: 20,
    completionTokens: 60,
    tokenSource: 'usage',
    timePerOutputToken: (2 - 0.2) / 59,
    interChunkLatency: [0.04],
  });
  const plain = createSample();
  Object.assign(plain, {
    success: true,
    isStream: false,
    startTime: 3,
    completedTime: 6,
    queryLatency: 3,
    firstChunkLatency: 3,
    promptTokens: 20,
    completionTokens: 1,
    tokenSource: 'usage',
  });

  const table = buildPercentileTable([stream1, stream2, plain]);
  assert.equal(table.percentiles.length, 11);
  const ttft = table.columns['TTFT (ms)'];
  assert.equal(ttft[table.percentiles.indexOf('min')], 100);
  assert.equal(ttft[table.percentiles.indexOf('max')], 200);
  const latency = table.columns['Latency (s)'];
  assert.equal(latency[table.percentiles.indexOf('min')], 1);
  assert.equal(latency[table.percentiles.indexOf('max')], 3);
});