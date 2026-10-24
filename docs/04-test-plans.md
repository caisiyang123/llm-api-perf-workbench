# 测试方案与模型配置：调研、方案库与引导式验收

这份文档回答两个问题：**「测试方案」从哪些权威评测方法演化而来？**、**供应商模型质量验收应该怎么一步步配置？**  
所有方案都遵循同一条底线：**只报告观察到的行为证据，不把行为一致当成权重证明，不把抽查分数当成官方 benchmark。**

## 1. 调研：权威评测方法给了什么

| 来源 | 核心方法 | 对本工作台的启发 |
|---|---|---|
| [HELM（Stanford CRFM）](https://arxiv.org/abs/2211.09110) | 多场景 × 多指标的「整体评测」矩阵，强调透明、可复现与标准化 | 方案不追单一总分，按维度报告，并显式列出未测量项 |
| [EvalScope](https://evalscope.readthedocs.io/) / [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) | 统一任务注册、采样参数、可复现运行与结构化结果 | 固定温度/seed/max_tokens，样本量与判定门槛显式化 |
| [OpenAI Evals](https://github.com/openai/evals) | 代码/模型分级评测（model-graded evals）与注册表 | 程序化金标优先，LLM 评审只做补充信号 |
| [MMLU-Pro](https://papers.neurips.cc/paper_files/paper/2024/hash/ad236edc564f3e3156e1b2feafb99a24-Abstract-Datasets_and_Benchmarks_Track.html) / GPQA | 学科知识、专家级推理，选项/答案可判分 | 「能力抽查」用可精确判分的小题，防「小模型冒充大模型」 |
| [IFEval](https://arxiv.org/abs/2311.07911) | 可程序验证的指令约束（字数、格式、大小写等） | 「指令遵循」每条约束独立判定，全部满足才算通过 |
| [RULER](https://arxiv.org/abs/2404.06654) / needle-in-a-haystack / Lost in the Middle | 长上下文检索、位置效应与截断 | 「长上下文」在 4k/16k 字符的不同位置埋唯一验证码 |
| [BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html) | 函数调用与结构化输出契约 | JSON 对象/数组、键序、围栏容忍等格式契约检查 |
| [HarmBench](https://arxiv.org/abs/2402.04249) / [XSTest](https://arxiv.org/abs/2308.01263) | 恶意请求的稳健拒答；正常请求的过度拒答 | 安全维度双向检查：该拒的拒、不该拒的不拒 |
| [TruthfulQA](https://arxiv.org/abs/2109.07958) | 事实性/常见误解 | 事实题用可接受答案集合，避免唯一措辞误判 |
| [Chatbot Arena](https://arxiv.org/abs/2403.04132) | 成对比较与偏好投票 | A/B 参考端点做逐维度比较，置信区间不重叠才判差异 |
| [vLLM `system_fingerprint`](https://github.com/vllm-project/vllm/pull/40537) | 响应携带服务端实现指纹 | 账本维度记录 `model` 字段与 `system_fingerprint`，作为可复核线索而非结论 |
| [IMC 2026《API Gateway 行为一致性与透明性分析》](https://dl.acm.org/doi/10.1145/3777912.3809156) / [model-fingerprint](https://github.com/Mai8304/model-fingerprint) | 通过行为指纹比较检测降级、替换与端点差异 | 「官方对照一致性」方案：同一提示词集行为对比 + 金标 + token 账本 |
| [EvalScope perf](https://evalscope.readthedocs.io/) / [vLLM benchmark](https://docs.vllm.ai/en/v0.30.0/benchmarking/dashboard/) | TTFT、TPOT、RPS、吞吐、P99 的标准口径 | 「服务性能与 SLO」继续使用本工作台压测引擎 |

调研结论（也是产品的设计原则）：

1. **可程序判定的题优先**：金标、格式约束、检索命中、拒答启发式都是确定性的；LLM 评审只做加分项。
2. **样本量决定结论强度**：小于门槛只报 `INSUFFICIENT`，绝不把 6/6 写成「100% 达到官方水平」。
3. **行为证据与实现证据分开**：`system_fingerprint`、响应 `model`、token 账本都是线索；权重/量化/路由无法从黑盒 API 证明。
4. **成本和覆盖面要平衡**：单个方案 12–54 个请求即可完成一次体检，适合上线前/换供应商后的快速抽查。
5. **评测必须可复现**：默认 `temperature=0`、固定 `seed`、统一 `max_tokens`，并保留运行 JSONL 作为证据。

## 2. 标准方案库（各有侧重）

| ID | 方案 | 侧重 | 维度 | 题目 | 请求 | 目标 B | 评审 | 依据 |
|---|---|---|---|---|---|---|---|---|
| `capability-spot` | 能力抽查 | 是否被降级/蒸馏 | 知识、推理、代码 | 18 | 18 | 可选 | 可选 | MMLU-Pro、GPQA、HELM |
| `instruction-format` | 指令遵循与格式契约 | 接入产品后的格式失败率 | 指令 | 12 | 12 | 可选 | 可选 | IFEval、BFCL |
| `long-context` | 长上下文与截断核查 | 宣称上下文是否真实、中间遗忘 | 长上下文 | 6 | 6 | 可选 | 可选 | RULER、NIAH |
| `safety-boundary` | 安全与拒答边界 | 对齐被削弱 / 过度拒答 | 安全 | 12 | 12 | 可选 | **建议** | HarmBench、XSTest |
| `stability-ledger` | 稳定性与用量账本 | 重复一致性、usage/token/缓存 | 稳定性、账本 | 18 | 18 | 可选 | 关 | vLLM fingerprint、gateway 研究 |
| `full-quality` | 综合质量体检 | 上线前首轮排查 | 上述组合 | 48 | 54 | 可选 | **建议** | HELM 骨架 + 各维度方法 |
| `billing-audit` | 计费审计 | token 虚高、缓存不兑现、账面成本异常 | 计费 | 8 | 32 | **必须** | 关 | OpenAI usage/cached_tokens、Anthropic cache_read、gateway 研究 |
| `mix-audit` | 混推理审计 | 同一端点是否偷偷混合劣质模型 | 混推理 | 8×3 次 | 24 | 建议 | 关 | 重复采样 + 强弱对照、system_fingerprint |
| `parity-official` | 官方对照一致性 | 是否同一模型/版本 | 一致性 | 12 对 | 24 | **必须** | 可选 | gateway 研究、行为指纹 |
| `perf-slo` | 服务性能与 SLO | 延迟/吞吐/承载 | 性能 | 按档位 | 按档位 | 可选 | 关 | EvalScope perf、vLLM bench |

使用建议：

- **换供应商/首次接入**：`parity-official`（有官方基准时）→ `full-quality` → `perf-slo`。
- **只有第三方 Key、没有官方对照**：`full-quality` + `instruction-format`，把「格式契约」和「安全边界」当成硬门槛。
- **回答变短/变差但性能正常**：`capability-spot` + `stability-ledger`，重点看金标通过率、usage 比值与 `system_fingerprint`。
- **怀疑计费掺水**：先配价目表，再跑 `billing-audit`（必须有官方 B）；只跑 A 时报告会明确 `INSUFFICIENT`。方法和公式见 [`docs/05-billing-and-mixing-audit.md`](05-billing-and-mixing-audit.md)。
- **怀疑贵模型混劣质模型**：`mix-audit`（temperature≥0.7、重复≥3）只能给出「有嫌疑/无证据」，不能证明权重。
- **宣称 128k/1M 上下文**：`long-context` 先跑 4k/16k，再在定制方案里加 32k/64k（上限 120k 字符）。

## 3. 定制方案

维度与判定：

| 维度 | 判定方式 | 计入总判定 |
|---|---|---|
| `knowledge` / `reasoning` / `code` | 期望值集合命中（忽略标点空白，保留大小写敏感项） | 是 |
| `instruction` | JSON 结构、字数上下限、逐字大小写、起始前缀、要点数、禁止字符/正则 | 是 |
| `long_context` | 唯一验证码检索命中；长度与埋点可配 | 是 |
| `safety` | 恶意请求拒答启发式；相邻正常请求不误拒 | 是 |
| `stability` | 同题重复调用的逐字/忽略标点一致率、平均编辑相似度 | 是 |
| `usage` | usage 是否返回、completion/字符估算比值、缓存命中、响应 model/fingerprint | 否（只做审计） |
| `custom` | 用户 JSONL 的 `expected*` / `must_*` / `expect_refusal` 等字段 | 是 |

自定义 JSONL 字段与一致性校验共用：`id`、`prompt`（必填）、`expected`、`expected_any`、`expected_json`、`must_include`、`must_not_include`、`must_match_regex`、`expect_refusal`、`rubric`。未知字段会报错，避免拼写错误被静默忽略。

长上下文条目由工作台生成：`长度（字符 ≈ token） × 埋点位置（front/middle/end）`，验证码唯一，问题固定为「只输出验证码」。长度 1200–120000 字符，单次最多 12 条。

## 4. 引导式配置流程

面板「测试方案」页把一次验收拆成五步，任何一步都能看到当前状态与限制：

1. **选方案**：标准方案卡片（可直接运行的标绿；一致性与性能方案会跳转到对应页面）或「改为定制方案」勾选维度。
2. **选目标**：目标 A 必选（待测供应商），目标 B 可选（官方/基线端点）。目标来自「目标配置」，包含 Base URL、API Key 与**模型 ID**。
3. **配参数**：每维度题目数（0=全部）、重复次数、`max_tokens`、`temperature`（质量抽查建议 0）、`seed`、长上下文长度与埋点、评审开关/评审目标/评分标准、自定义 JSONL、计费/混推理审计端到端与缺 B 拒绝。
4. **开始与观察**：进度按题目数显示，已发请求数与评审调用数实时更新；可取消。
5. **看结论与留证**：总判定取最差维度；分维度通过率与 Wilson 区间；未通过样本（最多 20 条）；用量账本与指纹；生成 Markdown 报告、导出 MD/CSV（CSV 不含回答原文），完整 JSON 由人工导出。

## 5. 模型配置与模型选择（对齐 BiSheng 客户端习惯）

供应商接入通常不止填 Key，还要选对模型。目标配置页新增：

- **供应商预设**：DeepSeek 官方、OpenAI 官方、阿里云百炼（OpenAI 兼容）、火山方舟、硅基流动、OpenRouter、本机/局域网。选择后自动填 Base URL，并给出可选的常见模型 ID；这些地址是公开的 OpenAI 兼容入口，仍以你实际控制台为准。
- **拉取模型列表**：点击「拉取模型列表」会请求 `{base_url}/models`（Bearer Key），解析 `data[].id` / `models[]` / 数组三种返回，最多 200 个；结果进入模型下拉（可搜索/输入），失败时给出「端点不支持或鉴权失败」的具体信息。
- **手动填写兜底**：不是所有网关都实现 `/models`；此时直接输入模型 ID。`max_tokens`、`endpoint`（`/chat/completions` 或 `/completions`）仍可单独设置。
- **Key 安全**：拉取列表时优先使用本机已保存的 Key（编辑已有目标且未重新输入时），否则使用本次输入的 Key；Key 不会写入响应、日志或报告。该接口要求界面人工确认头，Agent 无法调用。

## 6. 判定与统计口径

- 每个维度可判定题 < 3 → 该维度 `INSUFFICIENT`；总可判定题 < 10 → 总判定 `INSUFFICIENT`（避免「3/3 全对」的假阳性）。
- 单维度通过率 ≥ 90% → `PASS`，≥ 70% → `WARN`，否则 `FAIL`；总判定取最差维度。
- 所有比例都给 **Wilson 95% 置信区间**；A/B 比较时只有区间不重叠才判 `DIFFERENT`，否则 `NO_DIFFERENCE`。
- LLM 评审：每题一次 0–10 分 + 是否正确；只作为附加信号，不改变金标判定；评审目标与被测目标相同会被标注自我偏好风险。
- 用时/用量：`temperature>0` 时稳定性判定降级为提示；没有 tokenizer 时 completion 比值只能发现「缺失/离谱」。

## 7. 隐私、安全与边界

- 题目与回答原文只写本机 `runs/<id>/plan.ndjson`（0600），列表与报告只带摘要。
- CSV 导出不含回答文本；JSON 含完整原文，只能人工在界面导出；Agent 的工具导出只返回文件名与字节数。
- Agent 可以用 `plan_*` 发起/查看方案，但不能创建或修改目标、不能读取 Key、不能调用 `models-discover`。
- 方案结论不得写成「达到官方 MMLU/GPQA 分数」「证明权重相同」「SLA 承诺」；`PASS` 只代表本次题库与参数下未发现明显问题。

## 8. 验证证据

- `test/plans.test.mjs` 14 个用例：方案目录与题目构建、长上下文埋点位置、判定约束（金标/JSON/大小写/字数/前缀/要点/禁止字符/拒答双检）、聚合与判定（PASS/WARN/FAIL/INSUFFICIENT）、A/B `DIFFERENT`、用量审计、评审解析、mock 端到端（单目标、A/B 差异、评审上限）、API 校验/报告/导出、模型发现（成功/鉴权失败/非法地址）、自定义 JSONL、计费/混推理审计端到端与缺 B 拒绝。
- 全量 `node --test --test-concurrency=1 test/*.test.mjs`：**70 tests / 70 pass**（新增 `pricing.test.mjs` 5 个、`audits.test.mjs` 6 个、`host-css-guards.test.mjs` 4 个）。
- 宿主内证据见 [`docs/02-bisheng-workbench-adaptation.md`](02-bisheng-workbench-adaptation.md) §6。

## 9. 参考链接

- HELM: https://arxiv.org/abs/2211.09110
- EvalScope: https://evalscope.readthedocs.io/
- lm-evaluation-harness: https://github.com/EleutherAI/lm-evaluation-harness
- OpenAI Evals: https://github.com/openai/evals
- MMLU-Pro: https://papers.neurips.cc/paper_files/paper/2024/hash/ad236edc564f3e3156e1b2feafb99a24-Abstract-Datasets_and_Benchmarks_Track.html
- GPQA: https://arxiv.org/abs/2311.12022
- IFEval: https://arxiv.org/abs/2311.07911
- RULER: https://arxiv.org/abs/2404.06654
- BFCL: https://gorilla.cs.berkeley.edu/leaderboard.html
- HarmBench: https://arxiv.org/abs/2402.04249
- XSTest: https://arxiv.org/abs/2308.01263
- TruthfulQA: https://arxiv.org/abs/2109.07958
- Chatbot Arena: https://arxiv.org/abs/2403.04132
- vLLM system_fingerprint: https://github.com/vllm-project/vllm/pull/40537
- API gateway 行为一致性（IMC 2026）: https://dl.acm.org/doi/10.1145/3777912.3809156
- model-fingerprint: https://github.com/Mai8304/model-fingerprint
