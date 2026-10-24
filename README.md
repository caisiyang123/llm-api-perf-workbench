# 大模型 API 服务质量检测工作台（DSH / BiSheng 桌面插件）

本地检测任意 OpenAI 兼容大模型 API 的服务质量：延迟、RPS、TTFT、TPOT、输出 tok/s 与 tok/min、分档并发曲线、P99 与 SLO 边界；支持**双端点一致性校验 / 版本对齐**（官方 Key vs 第三方 Key）；还提供**标准/定制测试方案**（质量、计费是否掺水、是否混合劣质模型），以及可选的**价目表与推理性价比**核算。压测与抽查均在本机进程内完成，API Key 只写入本机数据目录，**不经任何远端服务**。

面板在左侧业务区，原生 Chat 在右侧；Agent 通过工具 `llm_perf_workbench` 读取目标与运行、发起压测、生成报告。

## 指标口径

指标定义与 [EvalScope](https://github.com/modelscope/evalscope) perf、vLLM bench 一致，便于交叉验证：

| 指标 | 定义 |
|---|---|
| TTFT | 从发出请求到收到第一个「携带可观测输出」的流式帧（含 DNS、连接、排队、预填充） |
| TPOT | `(总延迟 − TTFT) / (输出 token 数 − 1)` |
| ITL | 相邻输出帧间隔，用于观察输出抖动 |
| RPS | 成功请求数 ÷（首请求发出 → 末请求完成 的墙钟时间） |
| 输出 tok/s、tok/min | 输出 token 总数 ÷ 同一墙钟时间（分钟版 ×60） |
| P99 | 最近秩（nearest-rank）分位数，不是线性插值 |
| 成功率 | 成功请求 ÷ 发出的请求；非 2xx、流内 `{"error":...}`、超时、断流都算失败 |
| 最大并发 | **不是一次测得的数字**：由「吞吐不再随并发上升」（饱和点）与「SLO 仍满足」共同判定的上界 |

补充口径：

- TTFT/TPOT 的分母只用流式成功请求（非流式请求的「首帧」等于全延迟，混入会污染 TTFT）。
- 预热请求不进入指标，但保存在 `samples.ndjson` 中作为执行证据。
- token 数优先取服务端 `usage`；服务端不返回 usage 时用字符数估算，并在样本里标记 `tokenSource: "estimate"`，报告中单独统计。估算值不可用于验收。
- 空值沿用 EvalScope 的哨兵 `-1`（界面显示为「—」）。

## 一致性校验 / 版本对齐

「一个官方 Key + 一个第三方 Key，是否在服务同一个模型？」性能指标看不出来，需要比对回答：

- 同一提示词集、`temperature=0`、固定 `seed` 与 `max_tokens`，分别请求目标 A 与目标 B（非并发，先 A 后 B，重复时交替顺序）。
- 计算：完全一致率、规范化一致率、忽略标点空白后一致率、结构一致率、编辑相似度、3-gram Jaccard、长度比、token 差；全部带 Wilson 95% 置信区间。
- 金标质量：内置 12 条语料含算术/JSON/抽取/代码/拒答等可判定样本，也支持自定义 JSONL；按目标统计通过率。
- 可选 LLM 评审：从**已配置目标**里选评审模型，默认互换 A/B 顺序各评一次，位置不一致或评分自相矛盾的样本不计入胜负。
- 判定：有效样本 <10 对 → `INSUFFICIENT`；忽略标点一致率 <85% → `FAIL`；<95% → `WARN`；否则 `PASS`。

**必须如实理解**：行为一致是证据，不是权重证明。`PASS` 只表示「本次提示词集未观察到系统性差异」，不能写成「版本相同」；第三方镜像可能同权重但不同量化/路由/缓存，也可能部分题目一致、部分系统性偏移。完整口径、JSONL 字段与局限见 [`docs/03-consistency-quality.md`](docs/03-consistency-quality.md)。

原始回答只存本机 `runs/<id>/parity.ndjson`（0600），报告只截取差异最大的样本；Agent 只能看摘要，完整导出需人工在界面点击。

## 测试方案（供应商模型质量抽查）

性能回答「快不快、能承载多少」，一致性回答「是不是同一模型」，测试方案回答「质量有没有被降级」。面板「测试方案」页内置 10 个各有侧重的方案（依据 HELM、EvalScope、IFEval、RULER、HarmBench/XSTest、vLLM 行为指纹等权威方法，详见 [`docs/04-test-plans.md`](docs/04-test-plans.md)）：

| 方案 | 侧重 | 题目 / 请求 | 目标 B |
|---|---|---|---|
| 能力抽查 | 小模型冒充、蒸馏降级 | 18 / 18 | 可选 |
| 指令遵循与格式契约 | 接入产品后的格式失败率 | 12 / 12 | 可选 |
| 长上下文与截断核查 | 4k/16k 字符不同位置检索 | 6 / 6 | 可选 |
| 安全与拒答边界 | 该拒的拒、不该拒的不拒 | 12 / 12 | 可选 |
| 稳定性与用量账本 | 重复一致、usage/缓存/指纹 | 18 / 18 | 可选 |
| 综合质量体检 | 上线前首轮排查 | 48 / 54 | 可选 |
| 计费审计 | token 虚高、缓存不兑现、账面成本异常 | 8 / 32 | **必须** |
| 混推理审计 | 同一端点偷偷混合劣质模型 | 8×3 / 24 | 建议 |
| 官方对照一致性 | 版本对齐 | 12 对 / 24 | 必须 |
| 服务性能与 SLO | 延迟/吞吐/承载 | 按档位 | 可选 |

也可以「改为定制方案」，勾选维度、每维度题数、重复次数、长上下文长度/埋点、temperature/seed、评审开关与评分标准，或用本机 JSONL 替换题库。

判定全部程序化（金标命中、JSON/字数/大小写/顺序约束、长上下文验证码命中、拒答启发式），评审只作补充；样本不足一律 `INSUFFICIENT`，`PASS` 只代表「本次题库与参数下未发现明显降级」。题目为本工作台自建小样本，**不复制受版权题库，也不代表官方 benchmark 分数**。

## 界面与设计

面板采用一套克制的设计系统：**中性色阶 + 单一强调色 + 语义状态色**；所有间距落在 4/8/12/16/24/32/48 的 8px 体系，字号固定在 12/13/15/16/20/24 的有限类型阶，圆角只用 8/12/999 三档。表格无竖线、数字右对齐并用等宽数字，状态是低调 pill；每屏只有一个主按钮。收起对话的状态类只挂 `.pb-root`，` :has()` 规则带 `:not([hidden])` 守卫并用 MutationObserver 兜住宿主切日常模式时的 `hidden` 变化；收起状态不持久化，避免跨模式/跨会话泄漏（v1.3.1 修复）。方案卡片按「侧重 + 题目量 + 耗时 + 依据」分层，选中态用强调色描边与浅色底；`prefers-color-scheme` 不生效时由宿主的 `data-ds-dark-theme` 切换独立深色 token（冷调表面，不是简单反色），窄容器下栅格自动折叠为单列。

## 计费审计、混推理审计与推理性价比

- **价目表（人工填写，Agent 只读）**：币种、输入/输出/缓存命中单价（每百万 token）、厂商折扣、批量任务折扣、时区、闲时/忙时时段倍率；成本公式与价格快照写入报告。批量价按本次运行勾选「按批量任务计价」生效。
- **计费审计 `billing-audit`**：必须同时选目标 A 与官方 B。8 道受控探针（短/中/长 + 共享长前缀缓存探针，每题重复 2 次）比较 `prompt_tokens` / `completion_tokens` 比值、缓存命中率，并用 B 的 usage × A 的价目表复核账面成本。配对不足或没有 B → `INSUFFICIENT`；tokenizer/模板差异会假阳性，报告带 caveat。
- **混推理审计 `mix-audit`**：4 道强题 + 4 道对照题，各重复 3–5 次、temperature≥0.7，逐样本判分，检测「有时过、有时不过」的混合；结论只到 `SUSPECT / NO_EVIDENCE / INCONCLUSIVE`，不能证明具体权重，合法 fallback 也会产生同样现象。
- **推理性价比**：总账面成本、每请求成本、每可判定题成本、每通过题成本、通过题/元；只对本次题库与参数有效，样本不足时不做采购决策。
- 方法、公式、样本量与限制见 [`docs/05-billing-and-mixing-audit.md`](docs/05-billing-and-mixing-audit.md)。

## 模型配置（对齐桌面客户端习惯）

目标配置页除 Base URL / API Key 外，提供**模型选择**：

- 供应商预设（DeepSeek、OpenAI、阿里云百炼、火山方舟、硅基流动、OpenRouter、本机/局域网）自动填 Base URL 并给出常见模型建议；
- 「拉取模型列表」请求 `{base_url}/models`，解析标准 `data[].id` 返回并填入可搜索的下拉；端点不支持时给出明确错误，仍可手动输入模型 ID；
- 模型列表探测可能使用本机已保存的 Key，因此**只允许界面人工点击**（需人工确认头），Agent 无法调用，Key 不会回显。

## 安装

从 DSH Desktop 的**工作台市场**安装（推荐）：搜索「大模型 API 质量台」并点击安装。

或从 GitHub Release 手动安装：

1. 下载最新 Release 的 `.tgz` 文件。
2. 在 Desktop 打开 **工作台管理 → 安装本地工作台**，选择 `.tgz` 文件。
3. **完全退出并重新打开** Desktop；左侧出现「API 质量台」。

从源码安装（开发者）：本仓库默认分支包含已构建的 `lib/client.js`，可直接从源码 commit 安装。

## 开发与测试

```bash
pnpm install                                        # 安装开发依赖
node --test --test-concurrency=1 test/*.test.mjs    # 70 个单测（串行更稳）
node browser-tests/mode-switch-repro.mjs            # 5 项跨模式浏览器回归
node build.mjs                                      # 构建自包含 lib/client.js
node scripts/check-workbench-package.mjs            # 42 项官方包规范静态校验
pnpm pack                                           # 打包
```

## 官方规范符合性与验证状态

对照[工作台开发规范](https://dshdesktop.com/workbench/docs/development.md)（2026-10-09 版）审查，`scripts/check-workbench-package.mjs` 42 项静态检查全部通过。

**已验证项**：

- 70 个单元测试全部通过（指标公式、引擎闭环/开环/取消、API 权限与导出、一致性校验、测试方案、价目表与审计、插件装配、客户端渲染、宿主 CSS 守卫）。
- 5 项无头 Chrome 跨模式回归（收起/展开对话 × 切换日常/工作台模式）。
- v1.3.2 在真实 Harness 实例中激活；`snapshot` 返回 `version:"1.3.2"`、10 个标准方案、客户端 bundle HTTP 200。
- 宿主内端到端：`models-discover`（人工确认头）返回模型列表且无 Key 泄漏；`plan-run` → `plan-detail` → `plan-report` → `plan-export` 跑通；带价目表保存目标、`billing-audit`、`mix-audit` 宿主内可执行。
- 验证环境：BISHENG Desktop 1.1.0 / macOS arm64 / Node v24.17.0。

**设计选择**：

- 未采用 `customFrame`：主流程是「配置目标 → 跑压测/方案 → 在同屏 Chat 里追问结果」，原生会话是主流程的一部分，因此选择标准分栏（`businessSide:"left"`、`businessWidth:0.66`）。
- `register()` 不声明 `id`，以 GitHub `owner/repo` 作为工作台身份。

**未测项**：真实供应商端点上的长时间稳定性、`/models` 在所有厂商上的兼容性、LLM 评审在真实端点上的 JSON 解析率。

## 使用流程

1. **目标配置**：填接口地址（`https://.../v1`）、模型名、端点（`/chat/completions` 或 `/completions`）、API Key。保存后只显示末四位。
2. **测试连接**：发一条 8 token 的非流式探测请求，只验证鉴权与可达性，不代表性能。
3. **发起压测**：
   - 闭环：并发档位（如 `1,2,4,8`）+ 每档请求数；用于回答「能承载多少并发」。
   - 开环：到达速率档位（如 `2,4,8` req/s）；用于回答「给定流量下表现如何」。两种模式结论不可混用。
   - 可选 SLO：P99 TTFT 上限、P99 延迟上限、最低成功率。
4. **运行结果**：分档表、三条并发曲线（RPS 与输出 tok/s、TTFT 均值与 P99、P99 延迟）、瓶颈判定、SLO 检查、分位数明细、数据可信度。
5. **导出**：JSON（完整运行）、CSV（分档指标）、Markdown（报告）；也可让右侧 Chat 读取同一份报告。
6. **对比**：最多 6 次运行并排比较末档指标。

## Agent 能力与边界

`llm_perf_workbench` 支持：`context`、`list_targets`、`test_connection`、`start`、`status`、`list_runs`、`report`、`compare`、`export`、`cancel`。

- Agent **只能使用界面已配置的目标**，不能新增/修改/删除目标，也不能读取 API Key 原文；目标是写操作且必须带界面人工确认头，Agent 无法伪造。
- 工具在非本工作台会话中直接拒绝；不得通过 HTTP、shell 或改文件绕过。
- 解释结果时必须给出样本量、token 来源与未测量维度。

## 数据与隐私

- 状态目录：`dshHomePath('llm-api-perf-workbench')`（macOS 一般在 `~/Library/Application Support/bisheng/harness/` 下），`targets.json` 权限 `0600`。
- 密钥不进入快照、Agent 工具输出、报告、导出文件与日志。
- 压测请求直接发往你配置的端点；本插件不向任何第三方上传数据。

## 与 EvalScope perf 的差异

| 项 | EvalScope perf | 本工作台 |
|---|---|---|
| 运行时 | Python + aiohttp | Node 原生，无需装 Python（桌面插件内置运行时） |
| 结果面 | 终端/HTML/SQLite/多图表 | 面板 + JSON/CSV/Markdown；保留分档曲线与分位数 |
| tokenizer | 缺 tokenizer 时报错 | 字符数估算并明确标记 `estimate` |
| 开环并发上限 | 无上限 | 硬上限 512，防止挂死端点耗尽本机句柄 |
| SLO | `--sla-auto-tune` 控制循环 | 对已测档位做 SLO 过滤 + 饱和点判定，不做自动调参 |
| 其它指标 | GPU、PD 分离、多轮、embedding、投机解码、trace | 未移植（本地单机压测不需要，也不具备采样条件） |
| 内容一致性 / 质量 | 无（perf 只测性能） | 双端点一致性校验 + 金标质量 + 标准/定制测试方案 + 可选 LLM 评审（本工作台新增，语义见 `docs/03`、`docs/04`） |

完整分析见 [`docs/01-evalscope-perf-deep-analysis.md`](docs/01-evalscope-perf-deep-analysis.md)，移植与适配说明见 [`docs/02-bisheng-workbench-adaptation.md`](docs/02-bisheng-workbench-adaptation.md)。
