# 迁移到 BiSheng / DSH 工作台格式：适配说明

上游测量语义来自 EvalScope perf（见 [`01-evalscope-perf-deep-analysis.md`](01-evalscope-perf-deep-analysis.md)）。本文记录它如何变成一个可安装、可被原生 Chat 调用、可导出证据的桌面工作台插件，以及所有与上游/规范不一致的地方。

## 1. 插件格式（对照官方《工作台开发规范》2026-10-09 §3）

```
dsh-llm-api-perf-workbench/
├── package.json            # npm 包清单 + dsh.bundle.patch + dsh.client
├── cordis.patch.yml        # 宿主启动时 insert 的服务条目
├── dsh/                    # 宿主侧 ESM（Node，无第三方依赖）
│   ├── index.js            # apply(ctx, config)：路由 / 工具 / 系统提示 / 所有权
│   ├── api.mjs             # 纯业务 API（面板与 Agent 共用）
│   ├── store.mjs           # 本地持久化
│   └── engine/             # 测量内核
│       ├── scheduler.mjs   # 闭环 / 开环 / 连接探测
│       ├── http.mjs        # Node http(s) + SSE + usage
│       ├── sse.mjs         # 增量解码与帧解析
│       ├── metrics.mjs     # 公式、分位数、token 估算
│       ├── dataset.mjs     # 提示词与请求体
│       ├── runner.mjs      # 回合编排、判定、RunManager
│       ├── plans.mjs       # 方案目录、题库、判定与账本审计
│       ├── plan-runner.mjs # 方案执行与计费/混推理审计汇总
│       ├── pricing.mjs     # 价目表校验、时区时段倍率与成本公式
│       └── audits.mjs      # A/B 计费对账、缓存比对、混推理审计、成本汇总
├── src/panel.js            # 客户端面板源码（React.createElement）
├── src/panel.css           # 面板样式与设计 token
├── build.mjs               # 把 CSS 内联进单文件客户端
├── lib/client.js           # 构建产物（自包含，无外部 import）
├── scripts/                # 官方包静态校验（check-workbench-package.mjs）
├── test/                   # 70 个测试 + mock 服务 + 渲染 harness
├── browser-tests/          # 跨模式收起/展开的真实 CSS 浏览器回归
└── LICENSE                 # MIT
```

关键清单字段：

| 字段 | 值 | 说明 |
|---|---|---|
| `name` | `dsh-llm-api-perf-workbench` | npm 包名，独立于工作台身份 |
| `repository.url` | `https://github.com/caisiyang123/llm-api-perf-workbench` | 工作台身份来源：规范化后为 `caisiyang123/llm-api-perf-workbench` |
| `exports["."]` | `./dsh/index.js` | 宿主入口 |
| `exports["./client"]` | `./lib/client.js` | 客户端入口，声明了 `dsh.client` 就必须存在 |
| `dsh.bundle.patch` | `./cordis.patch.yml` | 安装时把服务插入宿主 cordis 配置 |
| `dsh.client.platform` | `"web"` | 非 `web` 客户端模块不会加载 |
| `dsh.client.inject` | 含 `dsh-desktop-workbenches` | 只决定**客户端模块加载顺序**，不是 Cordis 服务注入 |
| `files` | `dsh, lib, docs, cordis.patch.yml, README.md, LICENSE` | `test/`、`src/`、`scripts/`、`node_modules/` 不进包 |

三个 identity 不要混：

1. **npm 包名** `dsh-llm-api-perf-workbench` —— 安装/卸载用。
2. **cordis 条目 id** `llm-api-perf-workbench` —— `cordis.patch.yml` 里的服务 id。
3. **工作台身份** `caisiyang123/llm-api-perf-workbench` —— `repository` 规范化结果，`sessionBindings` 与 `ownsSession()` 用的是它。

`cordis.patch.yml`：

```yaml
- insert:
    - id: llm-api-perf-workbench
      name: dsh-llm-api-perf-workbench
      config:
        root: !!js dshHomePath('llm-api-perf-workbench')
```

`root` 由宿主 `dshHomePath` 解析，插件自身不拼用户目录。

### 1.1 官方规范合规审查（2026-10-24）

对照 [工作台开发规范](https://dshdesktop.com/workbench/docs/development.md)（2026-10-09）逐节复核；环境为 **BISHENG Desktop 1.1.0 / macOS 26.5.1 / arm64 / Node 24.17.0**。

- **包与加载必须项**：`name`/SemVer、`main` 与 `exports["."]`、`dsh.bundle.patch`、`dsh.client.platform:"web"`、`dsh.client.inject` 含 `dsh-desktop-workbenches`、`exports["./client"]` 均通过；`cordis.patch.yml` 的 `name` 与 npm 包名一致。
- **服务端**：`name`/`inject` 导出、`Config` 为 Schemastery schema、路由独占 `/api/llm-api-perf/`、会话归属调用 `desktopWorkbenchOwnership.read()`、数据写入 `dshHomePath` 配置目录。
- **客户端**：已构建单文件；loader id 与包名一致；`register()` 提供 `title`、组件与规范 GitHub `repository`，未填旧 `id`/`workbenchId`，注销交给 `ctx.effect`；`businessWidth:0.66` 在 0.25–0.7 内。
- **本地安装入口**：当前 Desktop 的「安装本地工作台」读取含 `package.json` 的目录；`scripts/check-workbench-package.mjs` 42 项静态必检/建议检查全部通过。

修订项：补 `LICENSE`；`dsh-tools` 与 `dsh-client-connection` 的 peer 由裸精确 rc 改为 `>=0.2.0-rc.2 <0.3.0-0`（显式包含预发布分支）；包版本升到 **1.3.2**（业务逻辑不变）；安装文档改为官方本地目录入口。

**未采用项**：仍使用标准分栏而非 `customFrame`——本工作台的核心闭环是「跑分/抽查 → 在同屏原生 Chat 里追问指标与结论」，会话是主流程的一部分；如果改为纯报表场景，应改用 `customFrame:true` 并由工作台自行放置宿主传入的 `conversation` 节点。`register.category` 是当前 Desktop 运行时支持的本地分类扩展，不是官方文档列出的可选字段；上架市场时应改用市场分类 ID。


## 2. 宿主侧契约

```js
export const name = 'llm-api-perf-workbench';
export const inject = ['connection','tools','desktopWorkbenchOwnership','systemPrompt'];
export const Config = Schema.object({ root: Schema.string().required() });
export function apply(ctx, config) { … }
```

用到的宿主能力：

| 能力 | 用法 |
|---|---|
| `ctx.connection.fetch.register({path, methods, requestBody:'buffered', fetch})` | 注册 `/api/llm-api-perf/*`；`buffered` 让处理器直接 `await req.json()` |
| `ctx.tools.register(defineTool({…}))` | 注册 Agent 工具 `llm_perf_workbench` |
| `ctx.systemPrompt.section({name, order, text})` | 注入口径与边界（`order: 10210`，与航才工作台同区） |
| `ctx.desktopWorkbenchOwnership.read()` | 读 `sessionBindings` 校验会话归属 |
| `ctx.effect(fn)` | 生命周期挂载（客户端样式注入、工作台注册） |

### 2.1 HTTP 路由（24 条，前缀 `/api/llm-api-perf/`）

| 路由 | 方法 | 入参 | 出参要点 | 归属校验 |
|---|---|---|---|---|
| `snapshot` | GET | `?session_id=` | 目标（脱敏）、运行摘要、`active_run_id`、limits、defaults | 带 session 时校验 |
| `targets-save` | POST | 目标对象 | 脱敏后的目标 | 需 `x-llm-perf-human-review: 1` |
| `targets-delete` | POST | `{target_id}` | `{deleted}` | 需人工确认头 |
| `test` | POST | `{target_id?, session_id?}` | `{ok, latency_ms, error?}` | 带 session 时校验 |
| `run` | POST | `{target_id, plan, session_id?}` | `{run_id, status, plan}` | 带 session 时校验 |
| `runs` | GET | `?session_id=` | `{runs:[摘要]}` | 带 session 时校验 |
| `run-detail` | GET | `?run_id=&session_id=` | 完整运行 + 样本统计 | 带 session 时校验 |
| `cancel` | POST | `{run_id, session_id?}` | `{cancelled}` | 带 session 时校验 |
| `compare` | POST | `{run_ids: "a,b"}` | 最多 6 个运行的末档与分位数 | 无 |
| `report` | POST | `{run_id, session_id?}` | `{markdown}` | 带 session 时校验 |
| `export` | POST | `{run_id, format: json\|csv\|md}` | `{filename, mime, content}` | 带 session 时校验 |
| `parity-run` | POST | `{plan, session_id?}` | `{run_id, status, plan, prompt_count, pair_count}` | 带 session 时校验 |
| `parity-runs` | GET | `?session_id=` | `{runs:[校验摘要]}` | 带 session 时校验 |
| `parity-detail` | GET | `?run_id=&session_id=&rows=0` | 计划、判定、逐条配对（`rows=0` 时不含答案文本） | 带 session 时校验 |
| `parity-cancel` | POST | `{run_id, session_id?}` | `{cancelled}` | 带 session 时校验 |
| `parity-report` | POST | `{run_id, session_id?}` | `{markdown}`（≤24000 字符） | 带 session 时校验 |
| `parity-export` | POST | `{run_id, format}` | `{filename, mime, content}`；JSON 含完整原文 | 带 session 时校验 |
| `plan-run` | POST | `{plan, session_id?}` | `{run_id, status, plan, estimate, item_count}` | 带 session 时校验 |
| `plan-runs` | GET | `?session_id=` | `{runs:[方案摘要], plans, dimensions}` | 带 session 时校验 |
| `plan-detail` | GET | `?run_id=&session_id=&rows=0` | 方案详情 + 分维度判定；`rows=0` 不含回答文本 | 带 session 时校验 |
| `plan-cancel` | POST | `{run_id, session_id?}` | `{cancelled}` | 带 session 时校验 |
| `plan-report` | POST | `{run_id, session_id?}` | `{markdown}` | 带 session 时校验 |
| `plan-export` | POST | `{run_id, format}` | `{filename, mime, content}`；JSON 含完整原文 | 带 session 时校验 |
| `models-discover` | POST | `{base_url?, api_key?, target_id?}` | `{base_url, models[], latency_ms, hint}` | **必须人工确认头** |

错误统一 `{error: message}` + HTTP 400，`cache-control: no-store`。路由层不落日志，避免错误文本带出密钥。

设计取舍：**读操作允许无会话**（本地单用户、运行数据是全局的），**写目标必须带人工确认头**，**Agent 工具必须属于本工作台会话**。这样面板可以先配目标、跑基线，再创建会话让 Chat 参与分析；Agent 无法自己造目标把密钥写进去。

### 2.2 Agent 工具 `llm_perf_workbench`

| 参数 | 类型 | 说明 |
|---|---|---|
| `action` | enum | `context / list_targets / test_connection / start / status / list_runs / report / compare / export / cancel` + `parity_start / parity_status / parity_list / parity_report / parity_export / parity_cancel` + `plan_list / plan_start / plan_status / plan_report / plan_export / plan_cancel` |
| `target_id` | string | 目标 ID |
| `run_id` / `run_ids` | string | 单运行 / 对比列表 |
| `mode` | enum | `closed` 闭环 / `open` 开环 |
| `concurrency` / `rate` | string | 逗号分隔档位，如 `"1,2,4,8"` |
| `number` / `warmup` / `max_tokens` / `stream` / `duration_sec` | number | 负载参数；`warmup` 0–1 表示比例 |
| `dataset_source` / `random_tokens` / `file_path` | string | 提示词来源 |
| `slo_p99_ttft_ms` / `slo_p99_latency_ms` / `slo_min_success_rate` | number | SLO 阈值 |
| `target_b` | string | 一致性校验的目标 B（`target_id` 为目标 A） |
| `repeats` / `temperature` / `seed` | number | 一致性校验采样参数 |
| `judge_target_id` / `judge_swap` / `judge_rubric` | string/bool | 可选 LLM 评审目标、顺序互换、评分标准 |
| `plan_id` / `dimensions` / `per_dimension` | string | 测试方案：标准方案 ID / 定制维度 / 每维度题目数 |
| `long_context_lengths` / `long_context_depths` | string | 长上下文长度（字符近似 token）与埋点位置 |

权限矩阵：

| 动作 | 面板 | Agent 工具 |
|---|---|---|
| 读目标/运行 | ✅ | ✅（仅脱敏） |
| 新建/修改/删除目标 | ✅ 需人工确认头 | ❌ 无路由入口、无工具动作 |
| 读取 API Key 原文 | ❌ 只显示末四位 | ❌ |
| 发起/取消压测 | ✅ | ✅（需本工作台会话） |
| 发起/取消一致性校验 | ✅ | ✅（需本工作台会话；只能用界面已配置目标） |
| 发起/取消测试方案 | ✅ | ✅（标准/定制均可，也只能用已配置目标） |
| 拉取端点模型列表 | ✅ 需人工确认头 | ❌ 无工具动作、无路由入口 |
| 读取完整回答原文 | ✅ 本地详情/导出 | ❌ 只给摘要与截断差异样本 |
| 报告/导出 | ✅ | ✅（大文件只给文件名与体积，避免灌爆模型上下文） |
| 跨会话操作 | 校验 `sessionBindings` | 拒绝 |

工具输出上限：报告截断到 24000 字符；JSON/CSV 导出在工具里只返回 `filename/mime/bytes`，正文由面板下载。

### 2.3 客户端契约

```js
return { apply, inject: ['desktopWorkbenches','uiSession','uiWorkspace'] };
```

| 能力 | 用法 |
|---|---|
| `ctx.desktopWorkbenches.register({title, panelTitle, repository, description, category, layout}, Panel)` | 注册工作台；`layout: {businessSide:'left', businessWidth:0.66}`（规范要求 0.25–0.7） |
| `service.getSnapshot()` / `subscribe(fn)` | 读 `sessionBindings` 判断会话归属；面板每 2.5s 拉一次 API |
| `service.currentSession()` | 当前原生会话 id |
| `ctx.desktopWorkbenches.ownsSession(id)` | 写草稿前复核归属 |
| `ctx.uiWorkspace.pickDirectory()` + `ctx.desktopWorkbenches.ensureSession({folder})` | 「在 Chat 里分析」时若无会话则创建 |
| `ctx.uiSession.current.getSnapshot()` + `props.inputActions.setDraft` | 把问题/报告填入右侧原生 Chat 草稿 |

面板结构：`header`（品牌、Chat 折叠、创建会话）→ `nav`（总览/目标配置/发起压测/测试方案/一致性校验/运行结果/对比）→ 上下文条 → 滚动区 → footer 声明。目标配置页含供应商预设、`/models` 模型发现、模型下拉与可选计费价目表（币种/输入/输出/缓存命名单价、厂商与批量折扣、时区、最多 3 个时段窗口）；测试方案页含 10 个标准方案卡片（含计费审计与混推理审计）、批量计价开关、定制维度与分维度结果、计费/混推理审计区和成本表。CSS 通过 `<style>` 注入；设计 token 为「中性色阶 + 单一强调色 + 语义状态色」，间距全部落在 4/8/12/16/24/32/48 的 8px 体系上，字号取 12/13/15/16/20/24 的有限类型阶，圆角只用 8/12/999 三档；表格无竖线、数字右对齐并使用等宽数字，状态为低调 pill，主按钮每屏只出现一个。`data-ds-dark-theme` 有独立 token（非简单反色，表面带冷调）；`@container (max-width:860px)` 折叠栅格与方案卡片。收起对话不再给宿主 `.dshWbBody` 加 class，而是把 `pb-chat-collapsed` 挂在自己的 `.pb-root` 上，由带 `:not([hidden])` 守卫的 `:has()` 规则联动宿主布局。

图表是手写 SVG（无图表库依赖）：`chart(series, {xLabels, unit})` 生成网格、坐标轴、折线与数据点；NaN 点被过滤，不会画出断线坐标。

### 跨模式「收起对话」状态泄漏（v1.3.1 修复）

- **现象**：在工作台点「收起对话」后再切到日常对话模式，原生聊天框不可见；切回工作台后才恢复。
- **根因**：宿主切日常模式是给业务面板 `<aside class="dshWbBusiness">` 设 `hidden` 属性，**不移除 DOM**，原生对话区也保持挂载。旧规则 `.dshWbBody:has(> .dshWbBusiness .pb-root.pb-chat-collapsed) > .dshWbConversation{display:none}` 仍能匹配隐藏的 aside，导致收起效果跨模式继续生效；旧版还把状态写进 localStorage，跨会话/重启泄漏。
- **修法**（与航才工作台 v3.2.9 同源）：状态类只挂 `.pb-root`；`:has()` 链对宿主可隐藏元素一律加 `:not([hidden])`；增加 MutationObserver 同时观察 `.dshWbBody` 与 `.dshWbBusiness`（`hidden/style/class` 与父节点 childList），一旦业务面板被隐藏或移除就自动恢复对话展开；收起状态不持久化，`useState(true)`。
- **回归**：`test/host-css-guards.test.mjs` 4 条静态守卫；无头 Chrome 复现三态（业务可见→对话隐藏、aside `hidden`→对话恢复 1200px、恢复→再次隐藏）全部符合预期。

## 3. 测量引擎映射

| 职责 | 文件 | 要点 |
|---|---|---|
| 并发/到达调度 | `dsh/engine/scheduler.mjs` | 闭环信号量、开环 Poisson 绝对时间表、`probeConnection` |
| HTTP + SSE | `dsh/engine/http.mjs` / `sse.mjs` | keep-alive agent、增量 UTF-8、CRLF 归一、`data:` 剥离、`[DONE]`、200-in-band error |
| 指标 | `dsh/engine/metrics.mjs` | 均值、QPS、tok/s、tok/min、11 点分位数、token 估算 |
| 请求构造 | `dsh/engine/dataset.mjs` | 8 条内置语料（短/中/长）、随机填充、JSONL 文件、`stream_options.include_usage` |
| 编排与判定 | `dsh/engine/runner.mjs` | 逐档执行、预热、样本流式落盘、状态机、饱和点/SLO 分析 |
| 一致性纯函数 | `dsh/engine/parity.mjs` | 规范化/编辑相似度/3-gram/结构签名、Wilson 区间、金标检查、判定门槛、LLM 评审提示与解析 |
| 一致性编排 | `dsh/engine/parity-runner.mjs` | A/B 非并发配对、顺序交替、回答落盘、评审（含顺序互换与自相矛盾检测）、汇总 |
| 方案目录与题库 | `dsh/engine/plans.mjs` | 标准方案元数据、可程序判定的题库（知识/推理/代码/指令/安全/稳定性）、计费探针（短/中/长/共享缓存前缀）、混推理强弱探针、长上下文生成、分维度判定与 A/B 比较、用量审计 |
| 方案编排 | `dsh/engine/plan-runner.mjs` | 标准/定制方案执行、目标 A（可选 B）、重复稳定性、LLM 评审、批量/标准计价模式、计费审计与混推理审计汇总、`plan.ndjson` 落盘 |
| 价目表与成本 | `dsh/engine/pricing.mjs` | 价目表校验与归一、时区时段倍率（重叠窗口相乘）、成本公式（输入/缓存/输出 × 时段 × 厂商折扣 × 批量折扣） |
| 审计纯函数 | `dsh/engine/audits.mjs` | A/B usage 比值与缓存命中对比、账面成本复核、混推理逐样本判分、成本汇总 |
| 持久化 | `dsh/store.mjs` | 原子写、run id 校验、样本追加（压测 `samples.ndjson` / 一致性 `parity.ndjson`） |

字段映射（EvalScope → 本工作台）：

| EvalScope | 本工作台 |
|---|---|
| `total_requests` | `summary.total_requests` |
| `succeed_requests` / `failed_requests` | `summary.succeed_requests` / `failed_requests` |
| `qps` | `summary.qps`（另加 `requests_per_minute`） |
| `avg_latency` / `avg_first_chunk_latency` / `avg_time_per_output_token` | `avg_latency` / `avg_ttft` / `avg_tpot`（秒） |
| `avg_output_token_throughput` | `output_token_throughput`（另加 `output_tokens_per_minute`） |
| `avg_total_token_throughput` | `total_token_throughput`（另加 `total_tokens_per_minute`） |
| `total_time` | `total_time`（墙钟） |
| `-1` 哨兵 | 保留 |

限制（`runner.mjs: LIMITS`）：最多 20 档、每档 20000 请求、单次运行 120000 请求、并发 ≤2048、到达率 ≤5000 req/s、warmup ≤5000、max_tokens ≤32768、开环在途 ≤512。

## 4. 存储与安全

```
<dshHomePath>/
├── targets.json                # 0600，含 api_key 明文（本机唯一副本）
└── runs/
    └── <runId>/
        ├── meta.json           # 运行、分档摘要、判定（不含密钥）
        ├── samples.ndjson      # 压测：每条请求一行（含 warmup 行，不含提示词/回答）
        ├── parity.ndjson       # 一致性：每对一行，含提示词与两侧回答（本机 0600）
        ├── plan.ndjson         # 方案：每题每侧每样本一行（含提示词/回答，本机 0600）
        └── meta.json           # 方案汇总含 billing_audit / routing_audit / costs / pricing_snapshot
        └── plan.ndjson         # 测试方案：每题一行，含题目与回答原文（本机 0600）
```

- 写入一律 `tmp + rename` 原子替换；`targets.json` 创建时 `mode: 0o600`。
- `runId` 由时间戳 + 随机串生成，`store.assertRunId` 用 `/^[A-Za-z0-9-]{8,64}$/` 拒绝路径穿越。
- 样本按批串行追加（`flushChain`），避免并发写交错；运行中断/宿主重启时，`initialize()` 把残留 `running` 标为 `interrupted`。
- 脱敏：`maskTarget` 输出 `has_api_key` 与 `api_key_hint`（前 3 位 + 末 4 位），任何快照/报告/导出/工具输出都不包含 `api_key`。
- 残余风险（如实记录）：自定义请求头字段不脱敏。若用户把密钥放进 `x-api-key` 头，它会出现在本机 `targets.json`（文件仍 0600），但不会进入报告/导出/工具输出；面板只显示头名称。建议 SSO/网关令牌仍走 `api_key` 字段。

## 5. 偏差清单

与 EvalScope：

| 偏差 | 原因 | 影响 |
|---|---|---|
| 开环在途请求硬上限 512 | 挂死端点会无限建连，耗尽本机句柄/内存 | 极端慢端点（在途持续 >512）时到达率会被背压限制，此时测的是本机上限而非服务端 |
| 无 tokenizer，字符数估算 | 不引入词表依赖（插件体积/许可/版本漂移） | `tokenSource: "estimate"` 的吞吐只能横向比较，不能验收；报告单列计数 |
| 无 `--sla-auto-tune` | 自动调参会静默消耗配额；面板交互更适合人工设阈值 | 「最大并发」= 已测档位中满足 SLO 的最高档 + 饱和判定，不自动补测中间档 |
| `test_connection` 单次探测 | 桌面交互不宜每 10s 重试 6 小时 | 5xx/网络错误不自动重试；4xx 直接提示配置问题 |
| 无多轮/GPU/PD/embedding/投机解码/trace | 远程 API 无采样条件，且不属于单轮服务基线 | 报告中「未测量」清单显式列出 |
| 无 SQLite/HTML 报告 | 面板 + ndjson + JSON/CSV/MD 已覆盖本地复盘 | 二次分析直接读 `samples.ndjson` |
| 新增 tok/min、requests/min、token 来源计数、饱和/SLO 判定、运行对比 | 验收口径与工作台交互需要 | 字段只增不减，不改变上游公式 |

与工作台规范：

- 只注册 `title + repository`，不使用 legacy `id`；`businessWidth` 0.66 在允许区间内。
- 客户端是自包含单文件，`require` 只用共享基线的 `react`。
- 未使用 `dsh.client.inline` 等未文档化字段。

## 6. 验证证据

本机（BISHENG Desktop 1.1.0 / macOS 26.5.1 arm64 / Node v24.17.0，Harness 自带运行时）执行：

```bash
cd dsh-llm-api-perf-workbench
node --test --test-concurrency=1 test/*.test.mjs
# 70 tests, 70 pass, 0 fail（串行约 12s）
node browser-tests/mode-switch-repro.mjs   # 5 项跨模式浏览器回归（真实 panel.css + 无头 Chrome）
node build.mjs
node scripts/check-workbench-package.mjs   # 42 项静态校验
pnpm pack
tar -tzf dsh-llm-api-perf-workbench-1.3.2.tgz
```

覆盖：

1. `metrics.test.mjs`（4 个）：最近秩分位数（含 0/100→min/max）、warmup 不进指标、TTFT=总延迟、TPOT 公式、单 token 无 TPOT、流式/非流式分母分离。
2. `engine.test.mjs`（8 个）：闭环扫档端到端（TTFT/吞吐/分位数/样本行数/请求体含 usage 选项）、开环到达率、开环预热按速排程且不进指标、非流式、鉴权失败、读超时、取消、连接探测、非法端点拒绝。
3. `api.test.mjs`（5 个）：密钥不回显/更新保留/清空、跨会话拒绝、运行→详情→报告→导出→对比、无目标时的配置错误、URL 安全校验。
4. `parity.test.mjs`（17 个）：规范化/等价判定/编辑相似度/3-gram/结构签名/`pairMetrics`/Wilson；INSUFFICIENT/FAIL/WARN/PASS 与「标点差异不误判」；内置语料与 JSONL 校验；金标各类型；评审提示与容错解析、矛盾评审排除；mock HTTP 端到端（不同端点 FAIL、相同端点 PASS + 金标 100%、文件语料 INSUFFICIENT、非法计划被拒、CSV 不含原文/JSON 完整）；差异排序。
5. `plans.test.mjs`（14 个）：方案目录与题目构建、长上下文埋点位置、判定约束（金标/JSON/大小写/字数/前缀/要点/禁止字符/拒答双检）、聚合与 PASS/WARN/FAIL/INSUFFICIENT、A/B `DIFFERENT`、用量审计、评审解析、mock 端到端（单目标/AB 差异/评审上限）、API 校验/报告/导出、模型发现（成功/401/非法地址）、自定义 JSONL、计费/混推理审计端到端与缺 B 拒绝。
6. `plugin.test.mjs`（6 个）：`name/inject`、24 条路由齐全、工具与系统提示注册（含 parity/plan 动作）、人工确认头缺失时拒绝写目标与模型发现、非归属会话拒绝工具、Agent 工具对 mock 端点跑完 start→status→report→export、parity_* 与 plan_* 端到端（状态不返回回答原文）。
7. `pricing.test.mjs`（5 个）：价目表校验、时区时段倍率、输入/缓存/输出成本、折扣与批量价、目标归一化与 Key 掩码。
8. `audits.test.mjs`（6 个）：A/B token 虚高、缓存不兑现、缺 B/缺 usage 的 `INSUFFICIENT`、每通过题成本、混推理混合与 temperature=0 限制、B 自身混合不归因 A。
9. `client-render.test.mjs`（1 个）：直接执行构建后的 `lib/client.js`，验证 `window.__ModuleLoader__.load({id, factory})` 契约、CSS 内嵌、七页渲染（目标/压测/方案/一致性/结果含 3 张 SVG 曲线/对比）、未出现 `undefined`/`NaN`、密钥不出现在 DOM。
10. `host-css-guards.test.mjs`（4 个）：静态守卫跨边界 `:has()` 必须带 `:not([hidden])`、状态类只挂 `.pb-root`、收起状态不得写 localStorage、MutationObserver 必须同时观察 `.dshWbBody` 与 `.dshWbBusiness`。

浏览器回归（独立于单测）：`browser-tests/mode-switch-repro.mjs` 直接读取真实 `src/panel.css`，在无头 Chrome 中模拟宿主结构（`.dshWbBody` + `.dshWbConversation` + `aside.dshWbBusiness[hidden]`），断言 5 个场景：收起→工作台对话区归零、收起→切日常必须恢复 1200px、切回工作台重新收起、展开→可见、展开→切日常仍可见。

打包验证：

- tgz 内容为 `package.json`、`cordis.patch.yml`、`dsh/**`、`lib/client.js`、`README.md`、`LICENSE` 与 `docs/**`（含 `04-test-plans.md`、`05-billing-and-mixing-audit.md`）；无 `node_modules`/`test`/`src`/`scripts`/`browser-tests`。
- 解包后以 ESM 导入 `dsh/index.js` 成功，`exports` 路径与实际文件一致。
- `lib/client.js` 122,131 字节，`node --check` 通过（含计费/混推理审计与成本表）。



