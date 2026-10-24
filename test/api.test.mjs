import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../dsh/store.mjs';
import { RunManager, normalizeTarget } from '../dsh/engine/runner.mjs';
import { ParityManager } from '../dsh/engine/parity-runner.mjs';
import { PlanManager } from '../dsh/engine/plan-runner.mjs';
import { createApi } from '../dsh/api.mjs';
import { startMockServer, waitForRun } from './mock-server.mjs';

async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-api-'));
  const store = createStore(dir);
  const manager = new RunManager({ store });
  const parityManager = new ParityManager({ store });
  const planManager = new PlanManager({ store });
  await manager.initialize();
  await parityManager.initialize();
  await planManager.initialize();
  const api = createApi({
    store,
    manager,
    parityManager,
    planManager,
    verifyOwnership: options.verifyOwnership || (async () => {}),
  });
  return { dir, store, manager, parityManager, api, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('api never returns an API key', async () => {
  const ctx = await setup();
  try {
    const saved = await ctx.api.saveTarget({
      name: '多供应商 A',
      base_url: 'https://api.example.com/v1/',
      model: 'demo-model',
      api_key: 'sk-secret-value-1234',
    });
    assert.equal(saved.api_key, undefined);
    assert.equal(saved.has_api_key, true);
    assert.equal(saved.api_key_hint, 'sk-s…1234');

    const snapshot = await ctx.api.snapshot();
    assert.equal(JSON.stringify(snapshot).includes('sk-secret-value-1234'), false);

    // Blank key on update keeps the stored secret; explicit clear removes it.
    const updated = await ctx.api.saveTarget({ ...saved, id: saved.id, api_key: '' });
    assert.equal(updated.has_api_key, true);
    const stored = await ctx.store.readTargets();
    assert.equal(stored[0].api_key, 'sk-secret-value-1234');
    const cleared = await ctx.api.saveTarget({ ...saved, id: saved.id, api_key: '', clear_api_key: true });
    assert.equal(cleared.has_api_key, false);

    // Editing through the masked snapshot keeps custom header values that the UI cannot read.
    const withHeaders = await ctx.api.saveTarget({
      name: '带自定义头',
      base_url: 'https://api.example.com/v1',
      model: 'demo-model',
      api_key: 'sk-secret-value-1234',
      headers: { 'x-team': 'perf', 'x-routing': 'canary' },
    });
    assert.deepEqual(withHeaders.headers, ['x-team', 'x-routing']);
    const edited = await ctx.api.saveTarget({ ...withHeaders, api_key: '', headers: withHeaders.headers, headers_keep: true });
    assert.deepEqual(edited.headers, ['x-team', 'x-routing']);
    const storedHeaders = (await ctx.store.readTargets()).find((item) => item.id === withHeaders.id);
    assert.deepEqual(storedHeaders.headers, { 'x-team': 'perf', 'x-routing': 'canary' });
    // A non-empty headers JSON replaces them explicitly.
    const replaced = await ctx.api.saveTarget({ ...withHeaders, api_key: '', headers: { 'x-team': 'prod' } });
    assert.deepEqual(replaced.headers, ['x-team']);
  } finally {
    await ctx.cleanup();
  }
});

test('api rejects cross-session access through the ownership callback', async () => {
  const ctx = await setup({
    verifyOwnership: async (sessionId) => {
      if (sessionId !== 'owned-session') throw new Error('此会话不属于本工作台');
    },
  });
  try {
    await assert.rejects(() => ctx.api.snapshot({ sessionId: 'other-session' }), /不属于本工作台/);
    const snapshot = await ctx.api.snapshot({ sessionId: 'owned-session' });
    assert.deepEqual(snapshot.targets, []);
  } finally {
    await ctx.cleanup();
  }
});

test('run -> detail -> report -> export -> compare', async () => {
  const mock = await startMockServer({ ttftMs: 12, chunkMs: 2, chunks: 6 });
  const ctx = await setup();
  try {
    const target = await ctx.api.saveTarget({
      name: 'mock',
      base_url: mock.baseUrl,
      model: 'mock-model',
      api_key: 'sk-test-key',
    });
    const plan = {
      mode: 'closed',
      concurrency: [1, 2],
      number: 3,
      warmup: 1,
      max_tokens: 16,
      sleep_between_rounds_sec: 0,
      slo: { p99_ttft_ms: 800, min_success_rate: 100 },
    };
    const started = await ctx.api.startRun({ targetId: target.id, plan });
    const run = await waitForRun(ctx.manager, started.run_id);
    assert.equal(run.status, 'completed');

    const detail = await ctx.api.getRun({ runId: run.id });
    assert.equal(detail.rounds.length, 2);
    assert.ok(detail.rounds[0].summary.output_tokens_per_minute > 0);
    assert.equal(detail.samples.count, 8); // 2 rounds x (3 measured + 1 warmup)
    assert.equal(detail.samples.warmup, 2);
    assert.equal(detail.target.api_key, undefined);

    const report = await ctx.api.report({ runId: run.id });
    assert.match(report.markdown, /大模型 API 服务质量压测报告/);
    assert.match(report.markdown, /TTFT/);
    assert.match(report.markdown, /token 来源/);
    assert.match(report.markdown, /未测量/);

    const jsonExport = await ctx.api.exportRun({ runId: run.id, format: 'json' });
    assert.match(jsonExport.filename, /\.json$/);
    const parsed = JSON.parse(jsonExport.content);
    assert.equal(parsed.run.id, run.id);
    assert.equal(JSON.stringify(parsed).includes('sk-test-key'), false);

    const csvExport = await ctx.api.exportRun({ runId: run.id, format: 'csv' });
    assert.match(csvExport.content, /p99_ttft_ms/);
    const mdExport = await ctx.api.exportRun({ runId: run.id, format: 'md' });
    assert.match(mdExport.content, /判定/);

    const started2 = await ctx.api.startRun({ targetId: target.id, plan: { ...plan, number: 2 } });
    await waitForRun(ctx.manager, started2.run_id);
    const compared = await ctx.api.compare({ runIds: `${run.id},${started2.run_id}` });
    assert.equal(compared.runs.length, 2);

    const cancelled = await ctx.api.cancelRun({ runId: run.id });
    assert.equal(cancelled.cancelled, true);
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test('starting a run without any target surfaces a setup error', async () => {
  const ctx = await setup();
  try {
    await assert.rejects(() => ctx.api.startRun({ plan: { mode: 'closed' } }), /尚未配置任何检测目标/);
    await assert.rejects(() => ctx.api.getRun({ runId: 'not-a-real-run' }), /未找到运行/);
  } finally {
    await ctx.cleanup();
  }
});

test('normalizeTarget rejects unsafe endpoint configuration', async () => {
  assert.throws(() => normalizeTarget({ name: 'x', base_url: 'file:///tmp/x', model: 'm' }), /http/);
  assert.throws(() => normalizeTarget({ name: 'x', base_url: 'http://user:pass@host/v1', model: 'm' }), /账号密码/);
  assert.throws(() => normalizeTarget({ name: '', base_url: 'https://a/v1', model: 'm' }), /名称/);
  const ok = normalizeTarget({ name: 'ok', base_url: 'https://a/v1/', model: 'm', headers: { 'x-team': 't' } });
  assert.equal(ok.base_url, 'https://a/v1');
});