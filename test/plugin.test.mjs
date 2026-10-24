import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, name, inject, OWNER } from '../dsh/index.js';
import { startMockServer } from './mock-server.mjs';

function createFakeContext(sessionBindings = {}) {
  const routes = new Map();
  const tools = [];
  const sections = [];
  const ctx = {
    connection: { fetch: { register: (options) => routes.set(options.path, options) } },
    tools: { register: (tool) => tools.push(tool) },
    systemPrompt: { section: (section) => sections.push(section) },
    desktopWorkbenchOwnership: { read: async () => ({ revision: 1, sessionBindings }) },
    effect: (fn) => fn(),
  };
  return { ctx, routes, tools, sections };
}

async function call(routes, path, { method = 'GET', body, headers = {} } = {}) {
  const [pathname, search = ''] = path.split('?');
  const route = routes.get(pathname);
  assert.ok(route, `route ${path} must be registered`);
  assert.ok(route.methods.includes(method));
  const request = new Request(`http://127.0.0.1${pathname}${search ? `?${search}` : ''}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const response = await route.fetch(request);
  return { status: response.status, data: await response.json() };
}

test('plugin wiring: name, inject, routes, tool, system prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-plugin-'));
  try {
    const { ctx, routes, tools, sections } = createFakeContext();
    apply(ctx, { root: dir });

    assert.equal(name, 'llm-api-perf-workbench');
    assert.deepEqual(inject, ['connection', 'tools', 'desktopWorkbenchOwnership', 'systemPrompt']);
    assert.equal(OWNER, 'caisiyang123/llm-api-perf-workbench');
    assert.deepEqual([...routes.keys()].sort(), [
      '/api/llm-api-perf/cancel',
      '/api/llm-api-perf/compare',
      '/api/llm-api-perf/export',
      '/api/llm-api-perf/models-discover',
      '/api/llm-api-perf/parity-cancel',
      '/api/llm-api-perf/parity-detail',
      '/api/llm-api-perf/parity-export',
      '/api/llm-api-perf/parity-report',
      '/api/llm-api-perf/parity-run',
      '/api/llm-api-perf/parity-runs',
      '/api/llm-api-perf/plan-cancel',
      '/api/llm-api-perf/plan-detail',
      '/api/llm-api-perf/plan-export',
      '/api/llm-api-perf/plan-report',
      '/api/llm-api-perf/plan-run',
      '/api/llm-api-perf/plan-runs',
      '/api/llm-api-perf/report',
      '/api/llm-api-perf/run',
      '/api/llm-api-perf/run-detail',
      '/api/llm-api-perf/runs',
      '/api/llm-api-perf/snapshot',
      '/api/llm-api-perf/targets-delete',
      '/api/llm-api-perf/targets-save',
      '/api/llm-api-perf/test',
    ]);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'llm_perf_workbench');
    assert.ok(tools[0].parameters.action.enum.includes('start'));
    assert.ok(tools[0].parameters.action.enum.includes('parity_start'));
    assert.ok(tools[0].parameters.action.enum.includes('parity_report'));
    assert.ok(tools[0].parameters.action.enum.includes('plan_start'));
    assert.ok(tools[0].parameters.action.enum.includes('plan_report'));
    assert.equal(sections.length, 1);
    assert.match(sections[0].text, /最大并发/);
    assert.match(sections[0].text, /一致性校验/);
    assert.match(sections[0].text, /测试方案/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plugin wiring: ownership and human-review enforcement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-plugin-'));
  try {
    const { ctx, routes, tools } = createFakeContext({
      'session-owned': OWNER,
      'session-other': 'someone/else',
    });
    apply(ctx, { root: dir });

    const sandbox = await call(routes, '/api/llm-api-perf/snapshot');
    assert.equal(sandbox.status, 200);
    assert.deepEqual(sandbox.data.targets, []);

    const owned = await call(routes, '/api/llm-api-perf/snapshot?session_id=session-owned');
    assert.equal(owned.status, 200);

    const foreign = await call(routes, '/api/llm-api-perf/snapshot?session_id=session-other');
    assert.equal(foreign.status, 400);
    assert.match(foreign.data.error, /不属于/);

    const freeWrite = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      body: { name: 'x', base_url: 'https://api.example.com/v1', model: 'm', api_key: 'sk-abcdef123456' },
    });
    assert.equal(freeWrite.status, 400);
    assert.match(freeWrite.data.error, /人工确认/);

    const humanWrite = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: {
        name: 'x', base_url: 'https://api.example.com/v1', model: 'm', api_key: 'sk-abcdef123456',
        pricing: { enabled: true, currency: 'CNY', input: 2, output: 8, cached_input: 0.5, vendor_discount_pct: 10, batch_discount_pct: 50, timezone: 'Asia/Shanghai', windows: [{ label: '闲时', weekdays: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '08:00', multiplier: 0.5 }] },
      },
    });
    assert.equal(humanWrite.status, 200);
    assert.equal(humanWrite.data.has_api_key, true);
    assert.equal(humanWrite.data.pricing.currency, 'CNY');
    assert.equal(humanWrite.data.pricing.windows[0].multiplier, 0.5);
    assert.equal(JSON.stringify(humanWrite.data).includes('sk-abcdef123456'), false);

    const badPricing = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: { name: 'bad', base_url: 'https://api.example.com/v1', model: 'm', pricing: { enabled: true, input: -1, output: 8 } },
    });
    assert.equal(badPricing.status, 400);
    assert.match(badPricing.data.error, /价目表/);

    await assert.rejects(
      async () => tools[0].execute({ action: 'context' }, { agent: { session: { id: 'session-other' } } }),
      /不属于/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plugin wiring: agent tool start -> status -> report against mock endpoint', async () => {
  const mock = await startMockServer({ ttftMs: 10, chunkMs: 2, chunks: 5 });
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-plugin-'));
  try {
    const { ctx, routes, tools } = createFakeContext({ 's1': OWNER });
    apply(ctx, { root: dir });

    const saved = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: { name: 'mock', base_url: mock.baseUrl, model: 'mock-model', api_key: 'sk-key' },
    });
    assert.equal(saved.status, 200);
    const targetId = saved.data.id;

    const tool = tools[0];
    const exec = { agent: { session: { id: 's1' } } };
    const context = JSON.parse(await tool.execute({ action: 'context' }, exec));
    assert.equal(context.targets.length, 1);
    assert.equal(JSON.stringify(context).includes('sk-key'), false);

    const started = JSON.parse(
      await tool.execute(
        {
          action: 'start',
          target_id: targetId,
          mode: 'closed',
          concurrency: '1,2',
          number: 2,
          warmup: 1,
          max_tokens: 8,
        },
        exec,
      ),
    );
    assert.ok(started.run_id);

    let detail;
    for (let i = 0; i < 200; i += 1) {
      detail = JSON.parse(await tool.execute({ action: 'status', run_id: started.run_id }, exec));
      if (detail.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(detail.status, 'completed');
    assert.equal(detail.rounds.length, 2);
    assert.ok(detail.rounds[1].summary.output_token_throughput > 0);

    const report = JSON.parse(await tool.execute({ action: 'report', run_id: started.run_id }, exec));
    assert.match(report.markdown, /压测报告/);

    const exported = JSON.parse(await tool.execute({ action: 'export', run_id: started.run_id, format: 'md' }, exec));
    assert.match(exported.content, /口径说明/);

    await assert.rejects(async () => tool.execute({ action: 'context' }, { agent: { session: { id: 'nope' } } }), /不属于/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await mock.close();
  }
});

test('plugin wiring: agent tool parity_start -> parity_status -> parity_report', async () => {
  const mock = await startMockServer({ ttftMs: 5, chunkMs: 2, chunks: 3 });
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-parity-plugin-'));
  try {
    const { ctx, routes, tools } = createFakeContext({ s1: OWNER });
    apply(ctx, { root: dir });

    const savedA = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: { name: '官方', base_url: mock.baseUrl, model: 'official', api_key: 'sk-a' },
    });
    const savedB = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: { name: '第三方', base_url: mock.baseUrl, model: 'reseller', api_key: 'sk-b' },
    });

    const tool = tools[0];
    const exec = { agent: { session: { id: 's1' } } };
    const started = JSON.parse(
      await tool.execute({ action: 'parity_start', target_id: savedA.data.id, target_b: savedB.data.id, repeats: 1, temperature: 0, seed: 42 }, exec),
    );
    assert.ok(started.run_id);
    assert.equal(started.pair_count, 12);

    let status;
    for (let i = 0; i < 300; i += 1) {
      status = JSON.parse(await tool.execute({ action: 'parity_status', run_id: started.run_id }, exec));
      if (status.status !== 'running' && status.status !== 'cancelling') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(status.status, 'completed');
    assert.equal(status.rows, undefined, 'agent status must not return answer text');
    assert.equal(status.verdict.status, 'PASS');

    const report = JSON.parse(await tool.execute({ action: 'parity_report', run_id: started.run_id }, exec));
    assert.match(report.markdown, /一致性校验报告/);
    assert.match(report.markdown, /行为一致性不是权重证明/);
    assert.equal(report.markdown.includes('sk-a'), false);

    const exported = JSON.parse(await tool.execute({ action: 'parity_export', run_id: started.run_id, format: 'md' }, exec));
    assert.match(exported.content, /一致性校验报告/);

    const list = JSON.parse(await tool.execute({ action: 'parity_list' }, exec));
    assert.equal(list.runs.length, 1);
    await assert.rejects(
      async () => tool.execute({ action: 'parity_status', run_id: started.run_id }, { agent: { session: { id: 'nope' } } }),
      /不属于/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await mock.close();
  }
});


test('plugin wiring: agent tool plan_start -> plan_status -> plan_report', async () => {
  const answers = [
    ['最大的海洋', '太平洋'],
    ['最长的河流', '长江'],
    ['红楼梦', '曹雪芹'],
    ['17 × 23', '372'],
    ['一个班有 40 人', '24'],
  ];
  const responder = ({ body }) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const prompt = messages.find((message) => message.role === 'user')?.content || '';
    const hit = answers.find(([needle]) => prompt.includes(needle));
    const content = hit ? hit[1] : '不知道。';
    return { content, usage: { prompt_tokens: 20, completion_tokens: 2 } };
  };
  const mock = await startMockServer({ responder });
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-plan-plugin-'));
  try {
    const { ctx, routes, tools } = createFakeContext({ s1: OWNER });
    apply(ctx, { root: dir });
    const saved = await call(routes, '/api/llm-api-perf/targets-save', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: { name: '待测', base_url: mock.baseUrl, model: 'candidate', api_key: 'sk-plan' },
    });
    const tool = tools[0];
    const exec = { agent: { session: { id: 's1' } } };

    const listed = JSON.parse(await tool.execute({ action: 'plan_list' }, exec));
    assert.ok(listed.plans.length >= 6);

    const started = JSON.parse(await tool.execute({
      action: 'plan_start',
      plan_id: 'capability-spot',
      target_id: saved.data.id,
      per_dimension: 2,
      max_tokens: 64,
    }, exec));
    assert.ok(started.run_id);
    assert.ok(started.item_count >= 4);

    let status;
    for (let i = 0; i < 300; i += 1) {
      status = JSON.parse(await tool.execute({ action: 'plan_status', run_id: started.run_id }, exec));
      if (status.status !== 'running' && status.status !== 'cancelling') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(status.status, 'completed', status.error);
    assert.equal(status.rows, undefined, 'agent status must not return answer text');
    assert.ok(status.summary.verdicts.overall.a);

    const report = JSON.parse(await tool.execute({ action: 'plan_report', run_id: started.run_id }, exec));
    assert.match(report.markdown, /测试方案报告/);
    assert.match(report.markdown, /行为证据不等于权重证明/);
    assert.equal(report.markdown.includes('sk-plan'), false);

    const exported = JSON.parse(await tool.execute({ action: 'plan_export', run_id: started.run_id, format: 'md' }, exec));
    assert.match(exported.content, /测试方案报告/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await mock.close();
  }
});

test('plugin wiring: models-discover requires the human-review header', async () => {
  const mock = await startMockServer({ models: ['deepseek-chat', 'deepseek-reasoner'] });
  const dir = await mkdtemp(join(tmpdir(), 'llm-perf-models-plugin-'));
  try {
    const { ctx, routes } = createFakeContext();
    apply(ctx, { root: dir });
    const denied = await call(routes, '/api/llm-api-perf/models-discover', {
      method: 'POST',
      body: { base_url: `${mock.baseUrl}/v1`, api_key: 'sk-hidden' },
    });
    assert.equal(denied.status, 400);
    assert.match(denied.data.error, /人工确认/);
    const discovered = await call(routes, '/api/llm-api-perf/models-discover', {
      method: 'POST',
      headers: { 'x-llm-perf-human-review': '1' },
      body: { base_url: `${mock.baseUrl}/v1`, api_key: 'sk-hidden' },
    });
    assert.deepEqual(discovered.data.models, ['deepseek-chat', 'deepseek-reasoner']);
    assert.equal(JSON.stringify(discovered.data).includes('sk-hidden'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await mock.close();
  }
});
