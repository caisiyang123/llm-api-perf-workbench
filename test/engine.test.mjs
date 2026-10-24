import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../dsh/store.mjs';
import { RunManager, normalizeTarget } from '../dsh/engine/runner.mjs';
import { startMockServer, waitForRun } from './mock-server.mjs';

async function withRun(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-test-'));
  const store = createStore(dir);
  const manager = new RunManager({ store });
  await manager.initialize();
  try {
    return await fn({ store, manager, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('closed-loop sweep measures TTFT, throughput and percentiles end to end', async () => {
  const mock = await startMockServer({ ttftMs: 15, chunkMs: 2, chunks: 10, withUsage: true });
  try {
    await withRun(async ({ store, manager }) => {
      const target = normalizeTarget({
        name: 'mock',
        base_url: mock.baseUrl,
        model: 'mock-model',
        api_key: 'test-key',
      });
      const run = await manager.start(
        {
          mode: 'closed',
          concurrency: [1, 2],
          number: 5,
          warmup: 2,
          max_tokens: 16,
          stream: true,
          sleep_between_rounds_sec: 0,
          slo: { p99_ttft_ms: 500, min_success_rate: 100 },
        },
        target,
      );
      const finished = await waitForRun(manager, run.id);
      assert.equal(finished.status, 'completed');
      assert.equal(finished.rounds.length, 2);

      for (const round of finished.rounds) {
        assert.equal(round.summary.total_requests, 5, 'warmup must not enter metrics');
        assert.equal(round.summary.succeed_requests, 5);
        assert.equal(round.summary.success_rate, 100);
        assert.ok(round.summary.qps > 0);
        assert.ok(round.summary.output_token_throughput > 0);
        assert.ok(round.summary.avg_ttft > 0, 'TTFT must be measured from the first output frame');
        assert.ok(round.summary.avg_ttft < round.summary.qps + 5);
        assert.equal(round.token_sources.usage, 5);
        assert.ok(round.percentiles.columns['TTFT (ms)'].length === 11);
        assert.ok(round.percentiles.columns['TTFT (ms)'][8] > 0);
      }

      // samples.ndjson: 2 rounds x (5 measured + 2 warmup) requests, warmup excluded from sums
      const lines = (await readFile(join(store.runsDir, run.id, 'samples.ndjson'), 'utf8'))
        .trim()
        .split('\n');
      assert.equal(lines.length, 14);

      assert.ok(['saturated', 'rising', 'single_point'].includes(finished.analysis.bottleneck.status));
      assert.ok(finished.analysis.slo.checks.length === 2);
      assert.equal(finished.analysis.slo.max_within_slo, 2);

      // request body really carried stream_options.include_usage
      assert.equal(mock.state.requests[0].body.stream, true);
      assert.equal(mock.state.requests[0].body.stream_options.include_usage, true);
      assert.equal(mock.state.requests[0].headers.authorization, 'Bearer test-key');
    });
  } finally {
    await mock.close();
  }
});

test('open-loop mode fires the configured arrival rate', async () => {
  const mock = await startMockServer({ ttftMs: 5, chunkMs: 1, chunks: 3 });
  try {
    await withRun(async ({ manager }) => {
      const target = normalizeTarget({ name: 'mock', base_url: mock.baseUrl, model: 'm', api_key: 'k' });
      const run = await manager.start(
        { mode: 'open', rate: [6], number: 3, max_tokens: 8, sleep_between_rounds_sec: 0 },
        target,
      );
      const finished = await waitForRun(manager, run.id);
      assert.equal(finished.status, 'completed');
      assert.equal(finished.rounds[0].rate, 6);
      assert.equal(finished.rounds[0].summary.total_requests, 3);
      assert.equal(finished.rounds[0].summary.succeed_requests, 3);
      assert.ok(finished.analysis.bottleneck.status === 'single_point');
    });
  } finally {
    await mock.close();
  }
});

test('open-loop mode also runs paced warmup and excludes it from metrics', async () => {
  const mock = await startMockServer({ ttftMs: 5, chunkMs: 1, chunks: 3 });
  try {
    await withRun(async ({ store, manager }) => {
      const target = normalizeTarget({ name: 'mock', base_url: mock.baseUrl, model: 'm', api_key: 'k' });
      const run = await manager.start(
        { mode: 'open', rate: [10], number: 3, warmup: 1, max_tokens: 8, sleep_between_rounds_sec: 0 },
        target,
      );
      const finished = await waitForRun(manager, run.id);
      assert.equal(finished.status, 'completed');
      assert.equal(finished.rounds[0].warmup, 1);
      assert.equal(finished.rounds[0].summary.total_requests, 3, 'warmup excluded from metrics');
      assert.equal(finished.rounds[0].dispatched, 4, 'warmup request was actually sent');
      const lines = (await readFile(join(store.runsDir, run.id, 'samples.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(lines.length, 4);
      assert.equal(lines.filter((row) => row.is_warmup).length, 1);
    });
  } finally {
    await mock.close();
  }
});

test('non-stream requests report latency without TTFT/TPOT', async () => {
  const mock = await startMockServer();
  try {
    await withRun(async ({ manager }) => {
      const target = normalizeTarget({ name: 'mock', base_url: mock.baseUrl, model: 'm', api_key: 'k' });
      const run = await manager.start(
        { mode: 'closed', concurrency: [1], number: 2, stream: false, max_tokens: 8, sleep_between_rounds_sec: 0 },
        target,
      );
      const finished = await waitForRun(manager, run.id);
      const round = finished.rounds[0];
      assert.equal(round.summary.succeed_requests, 2);
      assert.equal(round.summary.stream_requests, 0);
      assert.equal(round.summary.non_stream_requests, 2);
      assert.equal(round.summary.output_token_throughput, 2 / round.summary.total_time);
      assert.ok(round.percentiles.columns['TPOT (ms)'].every((v) => v === 0));
    });
  } finally {
    await mock.close();
  }
});

test('auth failures are counted, not hidden', async () => {
  const mock = await startMockServer({ authRequired: true });
  try {
    await withRun(async ({ manager }) => {
      const target = normalizeTarget({ name: 'no-key', base_url: mock.baseUrl, model: 'm' });
      const run = await manager.start(
        { mode: 'closed', concurrency: [1], number: 2, max_tokens: 8, sleep_between_rounds_sec: 0 },
        target,
      );
      const finished = await waitForRun(manager, run.id);
      const round = finished.rounds[0];
      assert.equal(round.summary.succeed_requests, 0);
      assert.equal(round.summary.success_rate, 0);
      assert.equal(finished.analysis.bottleneck.status, 'no_data');
      assert.ok(round.summary.failed_requests === 2);
    });
  } finally {
    await mock.close();
  }
});

test('read timeout produces a failure record instead of hanging', async () => {
  const mock = await startMockServer({ hangMs: 1500 });
  try {
    await withRun(async ({ manager }) => {
      const target = normalizeTarget({ name: 'slow', base_url: mock.baseUrl, model: 'm', api_key: 'k' });
      const run = await manager.start(
        {
          mode: 'closed',
          concurrency: [1],
          number: 1,
          max_tokens: 8,
          sleep_between_rounds_sec: 0,
          timeouts: { read_ms: 200, connect_ms: 1000, total_ms: 5000 },
        },
        target,
      );
      const finished = await waitForRun(manager, run.id);
      const round = finished.rounds[0];
      assert.equal(round.summary.succeed_requests, 0);
      assert.match(round.summary.total_requests === 1 ? '1' : '0', /1/);
    });
  } finally {
    await mock.close();
  }
});

test('cancellation stops the sweep and records status', async () => {
  const mock = await startMockServer({ ttftMs: 30, chunkMs: 8, chunks: 20 });
  try {
    await withRun(async ({ manager }) => {
      const target = normalizeTarget({ name: 'mock', base_url: mock.baseUrl, model: 'm', api_key: 'k' });
      const run = await manager.start(
        { mode: 'closed', concurrency: [4], number: 60, max_tokens: 8, sleep_between_rounds_sec: 0 },
        target,
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
      manager.cancel(run.id);
      const finished = await waitForRun(manager, run.id);
      assert.equal(finished.status, 'cancelled');
      assert.ok(finished.rounds[0].summary.total_requests < 60);
    });
  } finally {
    await mock.close();
  }
});

test('connection probe distinguishes success from auth failure', async () => {
  const mock = await startMockServer();
  try {
    await withRun(async ({ manager }) => {
      const ok = normalizeTarget({ name: 'ok', base_url: mock.baseUrl, model: 'm', api_key: 'k' });
      const good = await manager.testConnection(ok);
      assert.equal(good.ok, true);
      assert.ok(good.latency_ms > 0);

      const bad = normalizeTarget({ name: 'bad', base_url: mock.baseUrl, model: 'm' });
      const failure = await manager.testConnection(bad);
      assert.equal(failure.ok, false);
      assert.equal(failure.status_code, 401);
    });
  } finally {
    await mock.close();
  }
});