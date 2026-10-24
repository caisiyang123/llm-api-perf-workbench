/**
 * DSH host entry for the LLM API service-quality workbench.
 *
 * Responsibilities (same shape as the official workbench examples):
 *   - mount HTTP routes under /api/llm-api-perf/* for the panel
 *   - register the Agent tool `llm_perf_workbench`
 *   - contribute a system-prompt section
 *   - persist nothing in user workspaces: all state lives under config.root
 *
 * Guardrails:
 *   - API keys are write-only from the UI and are never returned to the panel,
 *     the Agent, tools, reports or exports.
 *   - target create/update/delete requires the panel's human-review header;
 *     the Agent cannot create targets and therefore cannot exfiltrate secrets.
 *   - tools reject sessions not owned by this workbench.
 */

import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createStore } from './store.mjs';
import { RunManager, LIMITS } from './engine/runner.mjs';
import { ParityManager } from './engine/parity-runner.mjs';
import { PlanManager } from './engine/plan-runner.mjs';
import { PLAN_LIMITS, STANDARD_PLANS } from './engine/plans.mjs';
import { createApi } from './api.mjs';

export const name = 'llm-api-perf-workbench';
export const inject = ['connection', 'tools', 'desktopWorkbenchOwnership', 'systemPrompt'];
export const Config = Schema.object({ root: Schema.string().required() });

/** Canonical repository identity, normalized to lowercase owner/repo by Desktop. */
export const OWNER = 'caisiyang123/llm-api-perf-workbench';

const ROUTE_PREFIX = '/api/llm-api-perf/';

export function apply(ctx, config) {
  const store = createStore(config.root);
  const manager = new RunManager({ store });
  const parityManager = new ParityManager({ store });
  const planManager = new PlanManager({ store });
  const api = createApi({ store, manager, parityManager, planManager, verifyOwnership: own });

  async function own(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('需要属于本工作台的会话');
    const ownership = await ctx.desktopWorkbenchOwnership.read();
    if (ownership.sessionBindings[sessionId] !== OWNER) {
      throw new Error('此会话不属于「大模型 API 质量工作台」，拒绝跨会话操作');
    }
  }

  const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  let initialization = null;
  const ready = () => {
    initialization ||= Promise.all([manager.initialize(), parityManager.initialize(), planManager.initialize()]).catch((error) => {
      initialization = null;
      throw error;
    });
    return initialization;
  };

  const route = (path, methods, handler) =>
    ctx.connection.fetch.register({
      path: ROUTE_PREFIX + path,
      methods,
      requestBody: 'buffered',
      async fetch(req) {
        try {
          await ready();
          return await handler(req);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      },
    });

  const humanOnly = (req) => {
    if (req.headers.get('x-llm-perf-human-review') !== '1') throw new Error('目标配置需在工作台界面人工确认');
  };

  route('snapshot', ['GET'], async (req) => {
    const sessionId = new URL(req.url).searchParams.get('session_id') || undefined;
    return json(await api.snapshot({ sessionId }));
  });

  route('targets-save', ['POST'], async (req) => {
    humanOnly(req);
    return json(await api.saveTarget(await req.json()));
  });

  route('targets-delete', ['POST'], async (req) => {
    humanOnly(req);
    const body = await req.json();
    return json(await api.deleteTarget(body.target_id));
  });

  route('test', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.testTarget({ targetId: body.target_id, sessionId: body.session_id }));
  });

  route('run', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.startRun({ sessionId: body.session_id, targetId: body.target_id, plan: body.plan }));
  });

  route('runs', ['GET'], async (req) => {
    const sessionId = new URL(req.url).searchParams.get('session_id') || undefined;
    return json(await api.listRuns({ sessionId }));
  });

  route('run-detail', ['GET'], async (req) => {
    const params = new URL(req.url).searchParams;
    return json(await api.getRun({ runId: params.get('run_id'), sessionId: params.get('session_id') || undefined }));
  });

  route('cancel', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.cancelRun({ runId: body.run_id, sessionId: body.session_id }));
  });

  route('compare', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.compare({ runIds: body.run_ids }));
  });

  route('report', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.report({ runId: body.run_id, sessionId: body.session_id }));
  });

  route('export', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.exportRun({ runId: body.run_id, format: body.format, sessionId: body.session_id }));
  });

  route('parity-run', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.startParity({ sessionId: body.session_id, plan: body.plan }));
  });

  route('parity-runs', ['GET'], async (req) => {
    const sessionId = new URL(req.url).searchParams.get('session_id') || undefined;
    return json(await api.listParityRuns({ sessionId }));
  });

  route('parity-detail', ['GET'], async (req) => {
    const params = new URL(req.url).searchParams;
    const includeRows = params.get('rows') !== '0';
    return json(await api.getParity({ runId: params.get('run_id'), sessionId: params.get('session_id') || undefined, includeRows }));
  });

  route('parity-cancel', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.cancelParity({ runId: body.run_id, sessionId: body.session_id }));
  });

  route('parity-report', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.parityReport({ runId: body.run_id, sessionId: body.session_id }));
  });

  route('parity-export', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.exportParity({ runId: body.run_id, format: body.format, sessionId: body.session_id }));
  });

  route('plan-run', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.startPlan({ sessionId: body.session_id, plan: body.plan }));
  });

  route('plan-runs', ['GET'], async (req) => {
    const sessionId = new URL(req.url).searchParams.get('session_id') || undefined;
    return json(await api.listPlanRuns({ sessionId }));
  });

  route('plan-detail', ['GET'], async (req) => {
    const params = new URL(req.url).searchParams;
    const includeRows = params.get('rows') !== '0';
    return json(await api.getPlan({ runId: params.get('run_id'), sessionId: params.get('session_id') || undefined, includeRows }));
  });

  route('plan-cancel', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.cancelPlan({ runId: body.run_id, sessionId: body.session_id }));
  });

  route('plan-report', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.planReport({ runId: body.run_id, sessionId: body.session_id }));
  });

  route('plan-export', ['POST'], async (req) => {
    const body = await req.json();
    return json(await api.exportPlan({ runId: body.run_id, format: body.format, sessionId: body.session_id }));
  });

  // Model discovery can use the stored API key, so it is human-UI only:
  // the same confirmation header as target writes is required.
  route('models-discover', ['POST'], async (req) => {
    humanOnly(req);
    const body = await req.json();
    return json(await api.discoverModels({ baseUrl: body.base_url, apiKey: body.api_key, targetId: body.target_id }));
  });

  function planFromArgs(args) {
    const splitList = (value, fallback) => {
      if (value == null || value === '') return fallback;
      const list = String(value)
        .split(/[,，\s]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
      return list.length ? list : fallback;
    };
    return {
      mode: args.mode === 'open' ? 'open' : 'closed',
      concurrency: splitList(args.concurrency, [1, 2, 4]),
      rate: splitList(args.rate, [1, 2, 4]),
      number: args.number,
      warmup: args.warmup,
      max_tokens: args.max_tokens,
      stream: args.stream,
      duration_sec: args.duration_sec,
      dataset: { source: args.dataset_source || 'builtin', random_tokens: args.random_tokens, file_path: args.file_path },
      slo: {
        p99_ttft_ms: args.slo_p99_ttft_ms,
        p99_latency_ms: args.slo_p99_latency_ms,
        min_success_rate: args.slo_min_success_rate,
      },
    };
  }

  function planFromArgsParity(args) {
    return {
      target_a: args.target_id || args.target_a,
      target_b: args.target_b,
      dataset: { source: args.dataset_source === 'file' ? 'file' : 'builtin', file_path: args.file_path },
      repeats: args.repeats,
      temperature: args.temperature,
      seed: args.seed,
      max_tokens: args.max_tokens,
      judge: {
        enabled: Boolean(args.judge_target_id),
        target_id: args.judge_target_id || null,
        swap: args.judge_swap !== false,
        rubric: args.judge_rubric || '',
      },
    };
  }

  function planFromArgsPlan(args) {
    const splitNumbers = (value) => {
      if (value == null || value === '') return undefined;
      const list = String(value).split(/[,，\s]+/).map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
      return list.length ? list : undefined;
    };
    const splitWords = (value) => {
      if (value == null || value === '') return undefined;
      const list = String(value).split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
      return list.length ? list : undefined;
    };
    return {
      plan_id: args.plan_id || 'custom',
      target_a: args.target_id,
      target_b: args.target_b || null,
      dimensions: splitWords(args.dimensions),
      per_dimension: args.per_dimension,
      repeats: args.repeats,
      temperature: args.temperature,
      seed: args.seed,
      max_tokens: args.max_tokens,
      long_context: {
        lengths: splitNumbers(args.long_context_lengths),
        depths: splitWords(args.long_context_depths),
      },
      dataset: { source: args.dataset_source === 'file' ? 'file' : 'builtin', file_path: args.file_path },
      judge: {
        enabled: Boolean(args.judge_target_id),
        target_id: args.judge_target_id || null,
        rubric: args.judge_rubric || '',
      },
    };
  }

  ctx.tools.register(
    defineTool({
      name: 'llm_perf_workbench',
      description:
        '本地大模型 API 服务质量检测工作台：读取目标与运行、发起压测、跑标准/定制测试方案、做双端点一致性校验、查看指标、生成报告与导出。仅在本工作台所属会话可用，普通会话会被拒绝。指标口径与 EvalScope/vLLM bench 一致：延迟、RPS、TTFT、TPOT/ITL、输出 tok/s 与 tok/min、P99、成功率、分档并发曲线；最大并发是由吞吐饱和点与 SLO 共同判定的上界，不是单次测得的数字。测试方案用于供应商模型质量抽查（能力、指令格式、长上下文、安全拒答、稳定性与用量账本），题目是本工作台自建小样本，不代表官方 benchmark 分数。Agent 不能创建/修改目标配置，也不能读取 API Key；不得经 HTTP、shell 或改文件绕过。发起压测/方案前先 context 确认目标与参数；解释结果时必须说明样本量、token 来源（服务端 usage 或估算）与未测量的维度，并明确行为证据不等于权重证明。',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['context', 'list_targets', 'test_connection', 'start', 'status', 'list_runs', 'report', 'compare', 'export', 'cancel', 'parity_start', 'parity_status', 'parity_list', 'parity_report', 'parity_export', 'parity_cancel', 'plan_list', 'plan_start', 'plan_status', 'plan_report', 'plan_export', 'plan_cancel'],
          description: 'context 先读实时目标与运行；start 发起压测；status 查询进度；report 生成 Markdown；export 导出 json/csv/md',
        },
        target_id: { type: 'string', description: '目标 ID（从 context/list_targets 获取）' },
        run_id: { type: 'string', description: '运行 ID；status/report/export/cancel 需要' },
        run_ids: { type: 'string', description: '逗号分隔的运行 ID 列表，用于 compare' },
        format: { type: 'string', enum: ['json', 'csv', 'md'], description: '导出格式' },
        mode: { type: 'string', enum: ['closed', 'open'], description: 'closed=并发上限闭环；open=泊松到达开环' },
        concurrency: { type: 'string', description: '闭环并发档位，逗号分隔，例如 "1,2,4,8"' },
        rate: { type: 'string', description: '开环到达速率档位，逗号分隔，例如 "1,2,4"' },
        number: { type: 'integer', description: '每档请求数（不含预热）' },
        warmup: { type: 'number', description: '每档预热数；0-1 之间表示比例' },
        max_tokens: { type: 'integer', description: '最大输出 token 数' },
        stream: { type: 'boolean', description: '是否使用流式 SSE（测 TTFT 必须为 true）' },
        duration_sec: { type: 'integer', description: '每档限时（秒），null 表示按请求数跑完' },
        dataset_source: { type: 'string', enum: ['builtin', 'random', 'file'], description: '提示词来源' },
        random_tokens: { type: 'integer', description: 'random 来源的近似输入 token 数' },
        file_path: { type: 'string', description: 'file 来源的 JSONL 绝对路径（仅本机路径）' },
        slo_p99_ttft_ms: { type: 'number', description: 'SLO：P99 TTFT 上限（毫秒）' },
        slo_p99_latency_ms: { type: 'number', description: 'SLO：P99 端到端延迟上限（毫秒）' },
        slo_min_success_rate: { type: 'number', description: 'SLO：最低成功率（%）' },
        target_b: { type: 'string', description: '一致性校验的目标 B（待核对端点）ID' },
        repeats: { type: 'integer', description: '一致性校验：每条提示词重复次数，1-3' },
        temperature: { type: 'number', description: '一致性校验：采样温度，默认 0' },
        seed: { type: 'integer', description: '一致性校验：采样种子，默认 42' },
        judge_target_id: { type: 'string', description: '一致性校验：LLM 评审目标 ID（可选，必须已配置）' },
        judge_swap: { type: 'boolean', description: '一致性校验：评审时是否互换答案顺序以暴露位置偏差，默认 true' },
        judge_rubric: { type: 'string', description: '一致性校验/测试方案：评审评分标准（可选）' },
        plan_id: { type: 'string', description: '测试方案 ID：标准方案（见 context.plans）或 custom' },
        dimensions: { type: 'string', description: '定制方案：逗号分隔的维度（knowledge,reasoning,code,instruction,long_context,safety,stability,usage）' },
        per_dimension: { type: 'integer', description: '定制方案：每维度最多题目数' },
        long_context_lengths: { type: 'string', description: '测试方案：长上下文长度（字符近似 token），逗号分隔，如 "4000,16000"' },
        long_context_depths: { type: 'string', description: '测试方案：埋点位置，逗号分隔，如 "front,middle,end"' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('需要当前 Agent 会话');
        const sessionId = exec.agent.session.id;
        await own(sessionId);
        switch (args.action) {
          case 'context':
            return JSON.stringify(await api.context({ sessionId }));
          case 'list_targets': {
            const snapshot = await api.snapshot({ sessionId });
            return JSON.stringify({ targets: snapshot.targets, limits: snapshot.limits });
          }
          case 'test_connection':
            return JSON.stringify(await api.testTarget({ targetId: args.target_id, sessionId }));
          case 'start': {
            const result = await api.startRun({ sessionId, targetId: args.target_id, plan: planFromArgs(args) });
            return JSON.stringify({ ...result, note: '压测已开始；用 status 查询进度，完成后用 report 生成报告。' });
          }
          case 'status': {
            const snapshot = await api.snapshot({ sessionId });
            const runId = args.run_id || snapshot.active_run_id;
            if (!runId) return JSON.stringify({ running: null, runs: snapshot.runs.slice(0, 5) });
            return JSON.stringify(await api.getRun({ runId, sessionId }));
          }
          case 'list_runs':
            return JSON.stringify(await api.listRuns({ sessionId }));
          case 'report':
            return JSON.stringify(await api.report({ runId: args.run_id, sessionId }));
          case 'compare':
            return JSON.stringify(await api.compare({ runIds: args.run_ids }));
          case 'export': {
            const exported = await api.exportRun({ runId: args.run_id, format: args.format || 'md', sessionId });
            if (exported.mime.startsWith('text/markdown')) return JSON.stringify(exported);
            return JSON.stringify({
              filename: exported.filename,
              mime: exported.mime,
              bytes: exported.content.length,
              note: '体积较大的导出请在工作台界面点击下载；此处只返回文件信息。',
            });
          }
          case 'cancel':
            return JSON.stringify(await api.cancelRun({ runId: args.run_id, sessionId }));
          case 'parity_start': {
            const result = await api.startParity({ sessionId, plan: planFromArgsParity(args) });
            return JSON.stringify({ ...result, note: '一致性校验已开始；用 parity_status 查询进度，完成后用 parity_report 生成报告。' });
          }
          case 'parity_status': {
            const list = await api.listParityRuns({ sessionId });
            const runId = args.run_id || list.runs.find((run) => run.status === 'running' || run.status === 'cancelling')?.id;
            if (!runId) return JSON.stringify({ running: null, runs: list.runs.slice(0, 5) });
            return JSON.stringify(await api.getParity({ runId, sessionId, includeRows: false }));
          }
          case 'parity_list':
            return JSON.stringify(await api.listParityRuns({ sessionId }));
          case 'parity_report':
            return JSON.stringify(await api.parityReport({ runId: args.run_id, sessionId }));
          case 'parity_export': {
            const exported = await api.exportParity({ runId: args.run_id, format: args.format || 'md', sessionId });
            if (exported.mime.startsWith('text/markdown')) return JSON.stringify(exported);
            return JSON.stringify({
              filename: exported.filename,
              mime: exported.mime,
              bytes: exported.content.length,
              note: '一致性与质量校验的原始回答只在工作台界面由人工导出；Agent 只返回文件信息。',
            });
          }
          case 'parity_cancel':
            return JSON.stringify(await api.cancelParity({ runId: args.run_id, sessionId }));
          case 'plan_list':
            return JSON.stringify(await api.listPlanRuns({ sessionId }));
          case 'plan_start': {
            const result = await api.startPlan({ sessionId, plan: planFromArgsPlan(args) });
            return JSON.stringify({ ...result, note: '测试方案已开始；用 plan_status 查询进度，完成后用 plan_report 生成报告。' });
          }
          case 'plan_status': {
            const list = await api.listPlanRuns({ sessionId });
            const runId = args.run_id || list.runs.find((run) => run.status === 'running' || run.status === 'cancelling')?.id;
            if (!runId) return JSON.stringify({ running: null, runs: list.runs.slice(0, 5) });
            return JSON.stringify(await api.getPlan({ runId, sessionId, includeRows: false }));
          }
          case 'plan_report':
            return JSON.stringify(await api.planReport({ runId: args.run_id, sessionId }));
          case 'plan_export': {
            const exported = await api.exportPlan({ runId: args.run_id, format: args.format || 'md', sessionId });
            if (exported.mime.startsWith('text/markdown')) return JSON.stringify(exported);
            return JSON.stringify({
              filename: exported.filename,
              mime: exported.mime,
              bytes: exported.content.length,
              note: '测试方案的原始回答只在工作台界面由人工导出；Agent 只返回文件信息。',
            });
          }
          case 'plan_cancel':
            return JSON.stringify(await api.cancelPlan({ runId: args.run_id, sessionId }));
          default:
            throw new Error(`未知动作：${args.action}`);
        }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `大模型 API 质量 · ${args.action}`,
        kind: ['context', 'list_targets', 'list_runs', 'status', 'report'].includes(args.action) ? 'read' : 'other',
        rawInput: args,
      }),
    }),
  );

  ctx.systemPrompt.section({
    name: 'llm-api-perf-workbench:tools',
    order: 10210,
    text: [
      '在「大模型 API 服务质量检测工作台」所属会话中，用户可通过 llm_perf_workbench 操作本地压测工作台。',
      `用法：先 context 读取已配置目标与最近运行，再 start 发起压测（闭环档位上限 ${LIMITS.maxConcurrency}，开环到达率上限 ${LIMITS.maxRate} req/s，每档请求上限 ${LIMITS.maxNumber}）。`,
      '指标口径：TTFT 为首个可观测输出帧到达时间（含连接与排队）；TPOT=(总延迟-TTFT)/(输出token-1)；RPS 与 tok/s 的分母是首请求发出到末请求完成的墙钟时间；P99 为最近秩；"最大并发"是由吞吐饱和点与 SLO 共同判定的上界，不是单次测得的数字，未触顶时必须说明"至少能承载"。',
      'Agent 只能使用界面已配置的目标，不能新增/修改目标，也不能读取 API Key；不得通过 HTTP、shell 或改文件绕过此限制。',
      '报告必须同时给出样本量、token 来源（服务端 usage / 本地估算）与未测量维度（队列与预填充拆分、reasoning token、多轮与缓存），不得把估算值当作验收数据，不得把本机出口网络的测量当作服务端内部时延。',
      '一致性校验用于核对两个端点是否在服务同一模型/版本：同一提示词集、temperature=0、固定 seed 与 max_tokens，比对完全一致率、规范化一致率、编辑相似度、结构一致性与金标准确率；启用 LLM 评审时会互换答案顺序检查位置偏差。行为一致性只是证据，不能证明权重、量化版本或路由相同；样本不足时必须说 INSUFFICIENT，不得用低样本通过率下结论；原始回答属于用户数据，Agent 只转述摘要与差异，不得伪造未测得的指标。',
      `测试方案（plan_*）用于供应商模型质量抽查：标准方案见 context.plans（能力抽查、指令格式、长上下文、安全拒答、稳定性与用量账本、综合体检；一致性与性能由各自页面执行），定制方案可选维度并支持本机 JSONL。发起前必须说明方案侧重、题目数、是否需要目标 B、是否启用评审与预计耗时；结果只能写「本次题库下未发现/发现明显差异」，不得外推为官方分数或权重结论。模型列表探测（models-discover）仅限人工界面，Agent 不得调用或绕过。`,
    ].join('\n'),
  });
}