/**
 * Render-test the built client bundle with a hook-compatible mini React.
 * Verifies: loader contract, embedded CSS, all five pages render, no `undefined`
 * leaks into visible text, and the API key never reaches the DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, render, click, textOf, findAll, installGlobals } from './harness/react-lite.mjs';

const PERCENTILE_LABELS = ['1%', '5%', '10%', '25%', '50%', '75%', '90%', '95%', '99%', 'min', 'max'];
const target = {
  id: 't1',
  name: '云厂商 A',
  base_url: 'https://api.example.com/v1',
  model: 'demo-chat',
  endpoint: 'chat',
  headers: [],
  has_api_key: true,
  api_key_hint: 'sk-a…1234',
  note: '华东区生产通道',
  updated_at: '2025-10-21T08:00:00.000Z',
  pricing: { enabled: true, currency: 'CNY', input: 2, output: 8, cached_input: 0.5, vendor_discount_pct: 10, batch_discount_pct: 50, timezone: 'Asia/Shanghai', windows: [{ label: '闲时', weekdays: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '08:00', multiplier: 0.5 }] },
};
const roundSummary = (index) => ({
  total_requests: 30,
  success_rate: 100,
  qps: 2.4 + index,
  requests_per_minute: (2.4 + index) * 60,
  avg_latency: 0.9 + index * 0.2,
  avg_ttft: 0.12 + index * 0.02,
  avg_tpot: 0.014,
  output_token_throughput: 180 + index * 40,
  output_tokens_per_minute: (180 + index * 40) * 60,
  total_token_throughput: 240 + index * 50,
  avg_prompt_tokens: 120,
  avg_completion_tokens: 64,
});
const round = (index, parallel) => ({
  key: String(parallel),
  parallel,
  rate: 1,
  number: 30,
  warmup: 2,
  dispatched: 32,
  skipped: 0,
  cancelled: false,
  started_at: '2025-10-21T08:00:00.000Z',
  finished_at: '2025-10-21T08:01:00.000Z',
  summary: roundSummary(index),
  percentiles: {
    percentiles: PERCENTILE_LABELS,
    columns: {
      'TTFT (ms)': [80, 90, 100, 110, 130, 150, 170, 175, 420, 70, 620],
      'Latency (s)': [0.5, 0.6, 0.7, 0.8, 1.1, 1.4, 1.8, 2.1, 4.2, 0.4, 6.1],
      'TPOT (ms)': [10, 11, 12, 13, 14, 15, 16, 17, 18, 9, 19],
      'Output token throughput (tok/s)': [160, 170, 175, 180, 185, 190, 195, 200, 210, 150, 220],
    },
  },
  token_sources: { usage: 30, estimate: 0, missing: 0 },
});
const detail = {
  id: 'run-11111111',
  created_at: '2025-10-21T08:00:00.000Z',
  updated_at: '2025-10-21T08:02:00.000Z',
  status: 'completed',
  target,
  plan: {
    mode: 'closed',
    list: [1, 2, 4],
    number: 30,
    warmup: 2,
    stream: true,
    max_tokens: 64,
    duration_sec: null,
    slo: { p99_ttft_ms: 800, p99_latency_ms: 3000, min_success_rate: 99 },
  },
  round_count: 3,
  progress: null,
  error: null,
  headline: {
    round: '4',
    qps: 4.4,
    success_rate: 100,
    avg_ttft_ms: 160,
    p99_ttft_ms: 420,
    output_tokens_per_second: 260,
    output_tokens_per_minute: 15600,
  },
  bottleneck: 'saturated',
  slo_max: 4,
  rounds: [round(0, 1), round(1, 2), round(2, 4)],
  analysis: {
    bottleneck: {
      status: 'saturated',
      message: '吞吐在 4 并发后不再增长，判定已达饱和点。',
      peak: { value: 4, dimension: 'concurrency', qps: 4.4 },
      latency_amplification: 1.86,
    },
    slo: {
      max_within_slo: 4,
      message: '8 并发起 P99 TTFT 超出 800ms，满足 SLO 的最高档位是 4。',
      checks: [
        { value: 1, dimension: 'concurrency', ok: true, failures: [], p99_ttft_ms: 420, p99_latency_ms: 4200, success_rate: 100 },
        { value: 8, dimension: 'concurrency', ok: false, failures: ['P99 TTFT 1200ms > 800ms'], p99_ttft_ms: 1200, p99_latency_ms: 5600, success_rate: 100 },
      ],
    },
  },
  samples: { count: 96, warmup: 6, failed: 0, by_round: { '1': 32, '2': 32, '4': 32 } },
};
const summary = {
  id: 'run-11111111',
  created_at: '2025-10-21T08:00:00.000Z',
  updated_at: '2025-10-21T08:02:00.000Z',
  status: 'completed',
  target,
  plan: detail.plan,
  round_count: 3,
  progress: null,
  error: null,
  headline: detail.headline,
  bottleneck: 'saturated',
  slo_max: 4,
};
const runningSummary = {
  ...summary,
  id: 'run-22222222',
  status: 'running',
  created_at: '2025-10-21T09:00:00.000Z',
  progress: { current_round: 2, total_rounds: 3, completed: 40, failed: 1, round_key: '2' },
  headline: null,
  slo_max: null,
};
const parityVerdict = { status: 'WARN', level: 'warn', reason: '多数回答一致，但存在系统性差异（措辞、长度或结构），建议人工核对差异样本' };
const qualityVerdict = { status: 'DIFFERENT', better: 'B', level: 'warn', reason: '两端点的金标准确率置信区间不重叠（A 100.0% / B 80.0%），B 更接近金标' };
const parityRun = {
  id: 'parity-11111111',
  kind: 'parity',
  created_at: '2025-10-21T10:00:00.000Z',
  updated_at: '2025-10-21T10:03:00.000Z',
  status: 'completed',
  plan: {
    targets: {
      a: { id: 't1', name: '云厂商 A', model: 'demo-chat', endpoint: 'chat', host: 'api.example.com' },
      b: { id: 't2', name: '第三方镜像', model: 'demo-chat', endpoint: 'chat', host: 'reseller.example.com' },
    },
    dataset: { source: 'builtin', file_path: '' },
    repeats: 1,
    temperature: 0,
    seed: 42,
    max_tokens: 64,
    judge: { enabled: true, target_id: 't1', target: { name: '云厂商 A', model: 'demo-chat' }, rubric: '', swap: true, self_judging: false },
  },
  prompt_count: 12,
  pair_count: 12,
  progress: { total_pairs: 12, completed_pairs: 12, failed_pairs: 0, judge_calls: 24 },
  error: null,
  verdict: parityVerdict,
  quality_verdict: qualityVerdict,
  headline: { pairs: 12, normalized_rate: 0.9167, exact_rate: 0.4167, mean_edit: 0.962, gold_a: 1, gold_b: 0.8 },
  summary: {
    parity: {
      pairs: 12,
      requested: 12,
      failed_a: 0,
      failed_b: 0,
      exact: { count: 5, rate: 0.4167, wilson: { low: 0.19, high: 0.68, p: 0.4167, n: 12 } },
      normalized: { count: 11, rate: 0.9167, wilson: { low: 0.65, high: 0.99, p: 0.9167, n: 12 } },
      tight: { count: 11, rate: 0.9167, wilson: { low: 0.65, high: 0.99, p: 0.9167, n: 12 } },
      structure: { count: 10, rate: 0.8333, wilson: { low: 0.55, high: 0.95, p: 0.8333, n: 12 } },
      mean_edit: 0.962,
      median_edit: 1,
      mean_jaccard: 0.74,
      median_length_ratio: 0.93,
      token_delta_mean: 2.4,
      latency_ms: { a: 420, b: 510 },
      verdict: parityVerdict,
    },
    quality: {
      gold: {
        a: { graded: 10, passed: 10, rate: 1, wilson: { low: 0.72, high: 1, p: 1, n: 10 }, failed_ids: [] },
        b: { graded: 10, passed: 8, rate: 0.8, wilson: { low: 0.49, high: 0.94, p: 0.8, n: 10 }, failed_ids: ['json-1', 'math-2'] },
      },
      judge: { calls: 24, judged: 12, decisive: 9, wins_a: 5, wins_b: 4, ties: 3, inconsistent: 0, mean_score_a: 8.1, mean_score_b: 7.6 },
      quality_verdict: qualityVerdict,
    },
    diffs: [
      {
        prompt_id: 'list-1',
        repeat: 0,
        exact: false,
        normalized: false,
        edit: 0.62,
        jaccard: 0.55,
        length_ratio: 0.8,
        judge_winner: 'B',
        prompt: '列出三种常见 HTTP 状态码及其含义，用「- 」列表输出。',
        answer_a: '- 200 OK\n- 404 Not Found\n- 500 Internal Server Error',
        answer_b: '200、404、500 分别表示成功、找不到与服务器错误。',
      },
    ],
    per_target: {
      a: { failures: 0, token_sources: { usage: 12, estimate: 0, missing: 0 } },
      b: { failures: 0, token_sources: { usage: 10, estimate: 2, missing: 0 } },
    },
  },
  rows: [
    {
      prompt_id: 'math-1', repeat: 0, order: 'A-first', prompt: '只输出计算结果：37 × 24 = ?',
      a: { success: true, text: '888', latency_ms: 380, status_code: 200, token_source: 'usage', usage: { prompt_tokens: 22, completion_tokens: 2 }, error: null },
      b: { success: true, text: '888', latency_ms: 402, status_code: 200, token_source: 'usage', usage: { prompt_tokens: 22, completion_tokens: 2 }, error: null },
      metrics: { exact: true, normalized: true, tight: true, edit: 1, jaccard: 1, length_ratio: 1, chars_a: 3, chars_b: 3, tokens_a: 2, tokens_b: 2, token_delta: 0, structure_same: true },
      gold_a: { passed: true }, gold_b: { passed: true },
      judge: { verdict: { score_a: 9, score_b: 9, winner: 'TIE', reason: '答案相同' }, consistent: true, calls: 2, error: null },
    },
    {
      prompt_id: 'list-1', repeat: 0, order: 'B-first', prompt: '列出三种常见 HTTP 状态码及其含义，用「- 」列表输出。',
      a: { success: true, text: '- 200 OK\n- 404 Not Found\n- 500 Internal Server Error', latency_ms: 640, status_code: 200, token_source: 'usage', usage: { prompt_tokens: 30, completion_tokens: 24 }, error: null },
      b: { success: true, text: '200、404、500 分别表示成功、找不到与服务器错误。', latency_ms: 700, status_code: 200, token_source: 'estimate', usage: { prompt_tokens: 30, completion_tokens: 18 }, error: null },
      metrics: { exact: false, normalized: false, tight: false, edit: 0.62, jaccard: 0.55, length_ratio: 0.8, chars_a: 70, chars_b: 28, tokens_a: 24, tokens_b: 18, token_delta: 6, structure_same: false },
      gold_a: { passed: true }, gold_b: { passed: true },
      judge: { verdict: { score_a: 8, score_b: 6, winner: 'A', reason: '格式一致' }, consistent: false, calls: 2, error: null },
    },
  ],
};
const paritySummary = {
  id: 'parity-11111111', kind: 'parity', created_at: '2025-10-21T10:00:00.000Z', updated_at: '2025-10-21T10:03:00.000Z',
  status: 'completed', plan: parityRun.plan, prompt_count: 12, pair_count: 12,
  progress: parityRun.progress, error: null, verdict: parityVerdict, quality_verdict: qualityVerdict, headline: parityRun.headline,
};
const planCatalog = [
  { id: 'capability-spot', title: '能力抽查 · 是否被降级', engine: 'plan', dimensions: ['knowledge', 'reasoning', 'code'], requires_b: false, judge: 'optional', item_count: 18, est_requests: 18, est_minutes: '1–2 分钟', emphasis: '识别小模型冒充大模型', references: ['MMLU / MMLU-Pro', 'GPQA', 'HELM'], tips: '题目少而精' },
  { id: 'instruction-format', title: '指令遵循与格式契约', engine: 'plan', dimensions: ['instruction'], requires_b: false, judge: 'optional', item_count: 12, est_requests: 12, est_minutes: '1 分钟', emphasis: 'JSON / 字数 / 大小写等可验证约束', references: ['IFEval', 'BFCL'], tips: '接入产品最常见的事故源' },
  { id: 'long-context', title: '长上下文与截断核查', engine: 'plan', dimensions: ['long_context'], requires_b: false, judge: 'optional', item_count: 6, est_requests: 6, est_minutes: '1–3 分钟', emphasis: '不同长度与位置检索', references: ['RULER'], tips: '字符按 token 近似' },
  { id: 'safety-boundary', title: '安全与拒答边界', engine: 'plan', dimensions: ['safety'], requires_b: false, judge: 'recommended', item_count: 12, est_requests: 12, est_minutes: '1 分钟', emphasis: '恶意请求拒答与正常请求不误拒', references: ['HarmBench', 'XSTest'], tips: '边界样本建议开评审' },
  { id: 'stability-ledger', title: '稳定性与用量账本', engine: 'plan', dimensions: ['stability', 'usage'], requires_b: false, judge: 'off', item_count: 18, est_requests: 18, est_minutes: '1–2 分钟', emphasis: '重复一致性、usage 与缓存痕迹', references: ['vLLM system_fingerprint'], tips: '没有官方 tokenizer' },
  { id: 'full-quality', title: '综合质量体检（推荐）', engine: 'plan', dimensions: ['knowledge', 'instruction', 'safety', 'long_context', 'stability', 'usage'], requires_b: false, judge: 'recommended', item_count: 48, est_requests: 54, est_minutes: '3–8 分钟', emphasis: '供应商上线前首轮排查', references: ['HELM'], tips: '样本仍属抽查' },
  { id: 'billing-audit', title: '计费审计 · token 与缓存对账', engine: 'plan', dimensions: ['billing'], requires_b: true, judge: 'off', item_count: 8, est_requests: 32, est_minutes: '2–4 分钟', emphasis: 'A/B 同题比较 usage 与账面成本', references: ['OpenAI usage', 'Anthropic cache_read_input_tokens'], tips: '没有 B 就没有虚高结论' },
  { id: 'mix-audit', title: '混推理审计 · 路由一致性', engine: 'plan', dimensions: ['routing'], requires_b: false, recommends_b: true, judge: 'off', default_temperature: 0.7, item_count: 8, est_requests: 24, est_minutes: '2–4 分钟', emphasis: '重复采样检查强弱题混合', references: ['HELM', 'system_fingerprint'], tips: '只能给嫌疑' },
  { id: 'parity-official', title: '官方对照一致性（版本对齐）', engine: 'parity', dimensions: ['consistency'], requires_b: true, judge: 'optional', item_count: 12, est_requests: 24, est_minutes: '1–2 分钟', emphasis: 'A/B 同时打同一提示词集', references: ['IMC 2026'], tips: '行为一致不是权重证明' },
  { id: 'perf-slo', title: '服务性能与 SLO', engine: 'bench', dimensions: ['performance'], requires_b: false, judge: 'off', item_count: 0, est_minutes: '5–30 分钟', emphasis: 'TTFT / RPS / 吞吐 / SLO', references: ['EvalScope perf'], tips: '最大并发是判定上界' },
];
const planSummary = {
  id: 'plan-11111111', kind: 'plan', created_at: '2025-10-21T11:00:00.000Z', updated_at: '2025-10-21T11:02:00.000Z',
  status: 'completed',
  plan: { plan_id: 'capability-spot', title: '能力抽查 · 是否被降级', targets: { a: { id: 't1', name: '云厂商 A', model: 'demo-chat', host: 'api.example.com' } }, dimensions: ['knowledge', 'reasoning', 'code'], repeats: 1, temperature: 0, max_tokens: 256, judge: { enabled: false }, long_context: null },
  item_count: 3, estimate: { requests: 3, inputTokens: 120, outputTokens: 192 },
  progress: { total_items: 3, completed_items: 3, requests: 3, failed_requests: 0, judge_calls: 0 },
  error: null, verdict: 'PASS', verdict_b: null, comparison: null,
  headline: { dimensions: { knowledge: { a: { graded: 3, passed: 3, rate: 1 } } }, judge_calls: 0, requests: 3, failed_requests: 0 },
};
const planDetail = {
  ...planSummary,
  summary: {
    plan_id: 'capability-spot', title: '能力抽查 · 是否被降级',
    dimensions: { knowledge: { items: 3, graded: 3, targets: { a: { graded: 3, passed: 3, rate: 1, wilson: { low: 0.44, high: 1, p: 1, n: 3 } } } } },
    verdicts: { overall: { a: { status: 'PASS', totalGraded: 3 } }, by_dimension: { knowledge: { a: { status: 'PASS', graded: 3, passed: 3, rate: 1, wilson: { low: 0.44, high: 1, p: 1, n: 3 } } } } },
    comparison: null, failed_items: [],
    usage: { a: { responses: 3, usage_reported: 3, usage_missing: 0, cached_responses: 0, completion_ratio_median: 1.1, completion_ratio_outliers: 0, reported_models: ['demo-chat'], system_fingerprints: [], note: '无官方 tokenizer' } },
    judge: { a: { calls: 0, scored: 0, mean_score: null } },
    requests: 3, failed_requests: 0, judge_calls: 0,
    token_source: { a: { usage: 3 } },
  },
  rows: [],
};

const snapshot = {
  targets: [target],
  runs: [summary, runningSummary],
  parity_runs: [paritySummary],
  plan_runs: [planSummary],
  plans: planCatalog,
  dimensions: { billing: { title: '计费审计', hint: 'usage 与缓存对账' }, routing: { title: '混推理审计', hint: '重复混合' }, knowledge: { title: '事实知识', hint: '常识与学科事实' }, instruction: { title: '指令遵循与格式', hint: '可验证约束' }, long_context: { title: '长上下文与截断', hint: '检索' }, safety: { title: '安全与拒答', hint: '拒答' }, stability: { title: '稳定性与缓存', hint: '重复一致' }, usage: { title: '用量与账本', hint: 'usage' } },
  active_run_id: 'run-22222222',
  active_parity_run_id: null,
  active_plan_run_id: null,
  limits: { maxConcurrency: 2048, maxRate: 5000, maxNumber: 20000, maxTokens: 32768 },
  defaults: {},
  version: '1.3.2',
};

const routes = {
  'snapshot': () => snapshot,
  'snapshot?session_id': () => snapshot,
  'run-detail?run_id=run-11111111': () => detail,
  'run-detail?run_id=run-22222222': () => ({ ...detail, id: 'run-22222222', status: 'running', rounds: detail.rounds.slice(0, 2), headline: null, analysis: null }),
  compare: () => ({ runs: [detail] }),
  'parity-runs': () => ({ runs: [paritySummary] }),
  'parity-detail?run_id=parity-11111111': () => parityRun,
  'parity-report': () => ({ run_id: parityRun.id, markdown: '# 一致性校验报告\n\n- 一致性判定：**WARN**' }),
  'parity-export': () => ({ filename: 'llm-api-parity-11111111.md', mime: 'text/markdown;charset=utf-8', content: '# 一致性校验报告' }),
  'parity-run': () => ({ run_id: 'parity-22222222', status: 'running', prompt_count: 12, pair_count: 12 }),
  'parity-cancel': () => ({ cancelled: true }),
  'plan-runs': () => ({ runs: [planSummary], plans: planCatalog }),
  'plan-detail?run_id=plan-11111111': () => planDetail,
  'plan-report': () => ({ run_id: planSummary.id, markdown: '# 测试方案报告\n\n- 方案：能力抽查' }),
  'plan-export': () => ({ filename: 'llm-api-plan-11111111.md', mime: 'text/markdown;charset=utf-8', content: '# 测试方案报告' }),
  'plan-run': () => ({ run_id: 'plan-22222222', status: 'running', item_count: 18, estimate: { requests: 18 } }),
  'plan-cancel': () => ({ cancelled: true }),
};

async function loadBundle() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const cssInside = source.includes('--pb-accent');
  let captured = null;
  const windowRef = {
    __ModuleLoader__: {
      load: (spec) => {
        captured = spec;
      },
    },
  };
  const evaluate = new Function(
    'window',
    'document',
    'localStorage',
    'fetch',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
    'URL',
    'console',
    source,
  );
  evaluate(
    windowRef,
    globalThis.document,
    globalThis.localStorage,
    (...args) => globalThis.fetch(...args),
    globalThis.setInterval,
    globalThis.clearInterval,
    globalThis.setTimeout,
    globalThis.clearTimeout,
    URL,
    console,
  );
  assert.ok(captured, 'client bundle must call window.__ModuleLoader__.load');
  return { spec: captured, cssInside };
}

test('client bundle: loader contract, CSS embedded, all pages render', async () => {
  const globals = installGlobals();
  try {
    const { spec, cssInside } = await loadBundle();
    assert.equal(spec.id, 'dsh-llm-api-perf-workbench');
    assert.equal(typeof spec.factory, 'function');
    assert.ok(cssInside, 'CSS must be embedded in the bundle');

    globalThis.fetch = async (url) => {
      const key = String(url).replace('/api/llm-api-perf/', '');
      const bases = Object.keys(routes).sort((a, b) => b.length - a.length);
      const match = bases.find((base) => key === base || key.startsWith(base));
      if (!match) throw new Error(`unexpected fetch: ${key}`);
      return { ok: true, json: async () => routes[match]() };
    };

    const plugin = spec.factory(createRequire());
    assert.deepEqual(plugin.inject, ['desktopWorkbenches', 'uiSession', 'uiWorkspace']);

    let descriptor = null;
    let Panel = null;
    const ctx = {
      effect: (fn) => fn(),
      desktopWorkbenches: {
        register: (meta, component) => {
          descriptor = meta;
          Panel = component;
          return () => {};
        },
      },
      uiWorkspace: { pickDirectory: async () => null },
      uiSession: { current: { getSnapshot: () => ({ key: 'none', props: { inputActions: {} }, hooks: { input: { getSnapshot: () => ({}) } } }) } },
    };
    plugin.apply(ctx);
    assert.ok(descriptor, 'workbench must register');
    assert.equal(descriptor.repository, 'https://github.com/caisiyang123/llm-api-perf-workbench');
    assert.equal(descriptor.layout.businessWidth, 0.66);
    assert.equal(descriptor.layout.businessSide, 'left');
    assert.ok(globals.styleTags.length >= 1, 'panel CSS must be injected');

    const service = {
      getSnapshot: () => ({ state: { sessionBindings: {} } }),
      subscribe: () => () => {},
      currentSession: () => null,
    };
    const { tree, instance } = await render(Panel, { service, entry: { id: 'caisiyang123/llm-api-perf-workbench' } });
    let visible = textOf(tree);
    assert.match(visible, /API 质量工作台/);
    assert.match(visible, /本地 API 服务质量检测台/);
    assert.match(visible, /云厂商 A/, 'overview must show the configured target');
    assert.match(visible, /最近运行记录/);
    assert.match(visible, /检测口径/);
    assert.doesNotMatch(visible, /undefined/);
    assert.doesNotMatch(visible, /NaN/);
    assert.doesNotMatch(visible, /sk-secret/);

    let tree2 = await click(instance, '目标配置');
    visible = textOf(tree2);
    assert.match(visible, /目标配置/);
    assert.match(visible, /sk-a…1234/, 'masked key hint is shown');
    assert.match(visible, /新增目标/);
    tree2 = await click(instance, '新增目标');
    visible = textOf(tree2);
    assert.match(visible, /供应商预设/);
    assert.match(visible, /拉取模型列表/);
    assert.match(visible, /模型（可从接口拉取后选择）/);
    assert.match(visible, /计费价目表（可选）/);
    assert.doesNotMatch(visible, /undefined/);
    tree2 = await click(instance, '取消');
    tree2 = await click(instance, '编辑');
    visible = textOf(tree2);
    assert.match(visible, /输入单价/, 'pricing form exposes input price');
    assert.match(visible, /缓存命中单价/);
    assert.match(visible, /时段倍率/);

    tree2 = await click(instance, '发起压测');
    visible = textOf(tree2);
    assert.match(visible, /总请求数/);
    assert.match(visible, /120 条（不含预热）/, '4 tiers x 30 requests preview');
    assert.match(visible, /SLO 阈值/);

    tree2 = await click(instance, '运行结果');
    visible = textOf(tree2);
    assert.match(visible, /分档指标/);
    assert.match(visible, /TTFT 均值/);
    assert.match(visible, /判定/);
    assert.match(visible, /吞吐在 4 并发后不再增长/);
    assert.match(visible, /P99 TTFT 1200ms > 800ms|满足 SLO 的最高档位是 4/);
    assert.match(visible, /分位数明细/);
    assert.match(visible, /数据可信度/);
    assert.doesNotMatch(visible, /undefined/);
    const svgs = findAll(tree2, (node) => node.type === 'svg');
    assert.ok(svgs.length >= 3, `expected 3 charts, got ${svgs.length}`);
    const polylines = findAll(tree2, (node) => node.type === 'polyline');
    assert.ok(polylines.length >= 1, 'charts must draw lines');

    tree2 = await click(instance, '测试方案');
    visible = textOf(tree2);
    assert.match(visible, /测试方案 · 供应商模型质量抽查/);
    assert.match(visible, /标准方案/);
    assert.match(visible, /能力抽查/);
    assert.match(visible, /定制方案/);
    assert.match(visible, /方案配置/);
    assert.match(visible, /结论与分维度结果/);
    assert.match(visible, /能力抽查 · 是否被降级/);
    assert.match(visible, /方法依据与局限/);
    assert.match(visible, /行为证据不等于权重证明/);
    assert.match(visible, /计费审计 · token 与缓存对账/);
    assert.match(visible, /混推理审计 · 路由一致性/);
    assert.match(visible, /按批量任务计价/);
    assert.match(visible, /目标 A 价目表/, 'plan form shows pricing availability');
    assert.doesNotMatch(visible, /undefined/);
    assert.doesNotMatch(visible, /NaN/);

    tree2 = await click(instance, '一致性校验');
    visible = textOf(tree2);
    assert.match(visible, /一致性校验 \/ 版本对齐/);
    assert.match(visible, /目标 A（基准端点）/);
    assert.match(visible, /内置一致性语料/);
    assert.match(visible, /启用了|启用 LLM 评审/);
    assert.match(visible, /有效配对/);
    assert.match(visible, /12 \/ 12/);
    assert.match(visible, /一致性：/);
    assert.match(visible, /金标质量/);
    assert.match(visible, /LLM 评审：24 次调用/);
    assert.match(visible, /差异最大的样本/);
    assert.match(visible, /200、404、500 分别表示成功/);
    assert.match(visible, /行为一致不是权重证明|不能证明什么/);
    assert.doesNotMatch(visible, /undefined/);
    assert.doesNotMatch(visible, /NaN/);

    tree2 = await click(instance, '对比');
    visible = textOf(tree2);
    assert.match(visible, /选择运行/);
    assert.match(visible, /对比结果/);

    tree2 = await click(instance, '总览');
    visible = textOf(tree2);
    assert.match(visible, /SLO 边界/);
    assert.match(visible, /满足声明 SLO 的最高档位/);
  } finally {
    globals.restore();
  }
});