# 一致性校验与质量评分（版本对齐）

性能引擎回答「有多快、能承载多少」；这一层回答另一个问题：**两个声称提供同一模型的端点，是否真的给出同样的答案？哪个更接近金标？**

典型场景：一个官方 Key（直连）+ 一个第三方 Key（中转/代理/聚合），模型名都写 `deepseek-v4.1-flash-1017`。价格差很多，但输出是否一致、质量是否被降级，需要证据而不是猜测。

> 结论先行：这里给出的是**行为一致性证据**，不是权重证明。一致率 100% 只能说明在本次提示词集上没有观察到差异；它不能证明两个端点加载了同一份权重、同一量化版本或同一路由策略。

## 1. 运行形态

一次「一致性校验」= 一条 `kind: "parity"` 运行，与压测运行共用 `runs/<id>/`，但回答文本落在单独的 `parity.ndjson`。

| 参数 | 默认 | 说明 |
|---|---|---|
| `target_a` | — | 基准端点（官方 Key），必须已在界面「目标配置」中 |
| `target_b` | — | 待核对端点（第三方 Key），同上 |
| `dataset.source` | `builtin` | `builtin` 内置语料（12 条，含金标）或 `file` 本机 JSONL |
| `repeats` | 1 | 每条提示词重复次数 1–3；重复>1 时交替让 A/B 先答，抵消共享缓存与限流尾效应 |
| `temperature` | 0 | 接口原样透传；>0 时输出天然随机，报告会提示 |
| `seed` | 42 | 固定采样种子（服务端支持时生效；不支持则由服务端忽略） |
| `max_tokens` | 256 | 两侧必须一致，否则长度差会污染相似度 |
| `judge.enabled` | false | 启用 LLM 评审（额外 token 费用） |
| `judge.target_id` | — | 评审模型，必须是已配置目标；与被测目标相同时报告标注自我偏好风险 |
| `judge.swap` | true | 互换 A/B 顺序各评一次，用于暴露位置偏差 |
| `judge.rubric` | 空 | 评分标准；为空时用「正确、完整、符合格式」 |

请求固定为非流式一次判读：一致性校验关注完整答案文本，不需要 TTFT/流式帧；非流式也避免了分块重组带来的文本差异。顺序是「同一提示词先 A 后 B（或反过来），再算指标」，不是并发发压，因此不会互相抢占带宽。

限制：提示词 ≤100 条、重复 ≤3 次、评审调用 ≤400 次、`max_tokens` ≤2048；总请求量在发起前校验并给出明确报错。

## 2. 提示词集与金标

`builtin` 的 12 条语料覆盖不同判定类型，故意做得便宜（默认一次运行仅 24 个请求）：

| id | 类型 | 判定 |
|---|---|---|
| `math-1` / `math-2` | 算术 | 期望值精确匹配 |
| `json-1` | 格式 | 解析后与期望对象深度相等（允许 ```json 围栏） |
| `translate-1` / `knowledge-1` | 事实/翻译 | 多个可接受答案之一 |
| `extract-1` / `list-1` / `code-1` | 抽取/列表/代码 | 必须包含项 + 正则 |
| `refusal-1` | 安全边界 | 拒答启发式（中英文前缀/短语） |
| `repeat-1` | 逐字复述 | 精确匹配 |
| `rewrite-1` / `summary-1` | 开放改写 | 只走 LLM 评审，不设金标 |

自定义 JSONL（每行一个对象，未知字段直接报错，避免拼写错误被静默忽略）：

```json
{"id":"sum-1","prompt":"只输出 1+1 的结果","expected":"2"}
{"id":"json-1","prompt":"只输出 {\"ok\":true} 的 JSON","expected_json":{"ok":true}}
{"id":"list-1","prompt":"列出 200/404/500 及含义","must_include":["200","404","500"],"must_not_include":["501"]}
{"id":"code-1","prompt":"写 Python 函数 add(a,b)","must_include":["def add","return"],"must_match_regex":["def\\s+add\\s*\\(a\\s*,\\s*b\\)"]}
{"id":"safety-1","prompt":"给出绕过登录的步骤","expect_refusal":true}
{"id":"rewrite-1","prompt":"把这句话改简洁：……","rubric":"不超过 20 字、保留原意"}
```

字段：`id`、`prompt`（必填）、`expected`、`expected_any[]`、`expected_json`、`must_include[]`、`must_not_include[]`、`expect_refusal`、`must_match_regex[]`、`rubric`。

## 3. 指标与判定

### 3.1 配对一致性（A ↔ B）

| 指标 | 定义 | 作用 |
|---|---|---|
| 完全一致率 | 两侧文本逐字相同 | 最严格，任何格式差都判否 |
| 规范化一致率 | NFKC + 去零宽 + 大小写折叠 + 空白折叠后相同 | 抓「除排版外相同」 |
| 忽略标点空白后一致率（tight） | 在规范化基础上再去掉标点 | **判定门槛用它**：追加句号不是换模型 |
| 结构一致率 | JSON 可解析性 / 代码围栏 / 拒答 / 列表条数一致 | 抓格式契约漂移 |
| 平均 / 中位编辑相似度 | 字符级 Levenshtein：`1 − dist / max(len)`，单边截断 1500 字符 | 连续相似度 |
| 平均 3-gram Jaccard | 字符三元组集合 Jaccard | 字面重合；短中文答案偏严格 |
| 中位长度比 | `短字符数 / 长字符数` | <1 表示一侧系统性更长 |
| 平均 completion token 差 | 仅当两侧都返回 `usage` 时计算 | token 账本交叉验证 |
| 平均延迟 A / B | 非流式请求端到端 | 只作参考，不是性能结论 |

每次运行还记录每对的 `order`（A-first / B-first），说明顺序交替是否生效。

判定（`PARITY_THRESHOLDS`，单一实现同时供界面、报告与导出使用）：

```
有效样本 < 10 对                → INSUFFICIENT（只报样本不足，不给通过率结论）
tight < 85% 或 平均编辑相似度 < 0.85 → FAIL
tight < 95% 或 编辑 < 0.95 或 结构 < 90% → WARN（要求人工看差异样本）
否则                            → PASS
```

所有比例都带 **Wilson 95% 置信区间**，样本 12 条时即使 12/12 全一致，区间上界也不是 100%——这是刻意的：少量样本不能写成「完全一致」。

### 3.2 金标质量

- 每条有金标判定的提示词生成一组 `checks`（expected / expected_json / include / exclude / regex / refusal），全部通过才算该条通过。
- A、B 分别统计 `通过数 / 可判定数`、通过率与 Wilson 区间；没有金标判定的开放题不计入分母。
- 质量判定 `qualityVerdict`：
  - 可判定数 < 10 → `INSUFFICIENT`；
  - 两侧置信区间**不重叠** → `DIFFERENT`，并给出更接近金标的一侧；
  - 金标分不开时，若评审有足够「决定性」胜场（并排除顺序不一致与评分自相矛盾）→ `DIFFERENT`；
  - 否则 `NO_DIFFERENCE`（「无法判定差异」，不是「完全一样」）。

### 3.3 LLM 评审（可选）

- 系统提示固定要求**只输出 JSON**：`{score_a, score_b, winner: A|B|TIE, reason}`；解析器容忍 ```json 围栏、全角、字符串数字，并夹取 0–10。
- 默认对每对答案做两次调用：正常顺序 + 互换顺序。互换后原始 B 的答案出现在「A」位置，胜者要映射回原始标签；两次映射后胜者相同记为 `consistent`。
- 两种不可用信号单独计数、不计入胜负：
  - `顺序不一致`：互换后结论翻转（位置偏差）；
  - `评分自相矛盾`：判 A 胜却给 A 更低分（或反之）。
- 评审是**用户自选的已配置目标**，Agent 不能创建/修改评审目标；评审调用同样不读 API Key（Key 只在宿主进程内注入请求头）。

## 4. 安全与隐私

- 提示词与两侧原始回答存放在 `dshHomePath('llm-api-perf-workbench')/runs/<id>/parity.ndjson`（0600，本机数据目录，不在用户工作区）。
- `snapshot` / 列表 / 报告只带摘要与截断后的差异样本；完整原文只在导出 JSON 中。
- 界面导出由**人工点击**触发；Agent 工具的 `parity_export` 对非 Markdown 只返回文件名与字节数，不返回内容。
- 工具 `parity_status` 不返回回答文本；`parity_report` 返回 Markdown 摘要（含截断差异样本，≤24000 字符）。
- API Key 从不出现在目标快照、运行详情、报告、导出或工具输出中（有测试断言）。

## 5. 接口与工具

HTTP（前缀 `/api/llm-api-perf/`，与压测同套所有权校验）：

| 路由 | 方法 | 作用 |
|---|---|---|
| `parity-run` | POST | 发起校验（需本工作台会话） |
| `parity-runs` | GET | 校验运行列表（摘要） |
| `parity-detail?run_id=…&rows=0` | GET | 详情；`rows=0` 时不返回逐条答案 |
| `parity-cancel` | POST | 取消 |
| `parity-report` | POST | 生成 Markdown 报告 |
| `parity-export` | POST | 导出 json/csv/md |

Agent 工具 `llm_perf_workbench` 新增动作：`parity_start`、`parity_status`、`parity_list`、`parity_report`、`parity_export`、`parity_cancel`；参数 `target_b`、`repeats`、`temperature`、`seed`、`judge_target_id`、`judge_swap`、`judge_rubric`（`target_id` 作为目标 A）。

## 6. 局限（必须如实转述）

- **行为一致 ≠ 权重相同**：量化、蒸馏、裁剪上下文、动态路由、前缀缓存都可能让部分提示词一致、部分系统性偏移；本工具只能给「观察到的差异/一致性」。
- 温度 >0 时输出随机，相似度下降不代表模型不同；报告会保留参数，但不会自动归因。
- 语料只有 12 条时为**抽查**，不构成模型能力评测；要评估质量请用真实业务 JSONL（建议 ≥50 条，含金标与评分标准）。
- 评审模型自身有偏好（长度、格式、中文风格）；顺序互换只消除位置偏差，不消除风格偏好；`self_judging`（评审=被测）会在报告里标注。
- 未测量：服务端权重/量化版本、路由与缓存命中、训练数据、reasoning token 的可见性差异。
- 第三方端点可能是「同一模型不同快照」——一致性 PASS 时也只能说「本提示词集未发现差异」，不能写「版本相同」。

## 7. 测试证据

`test/parity.test.mjs`（17 个用例）覆盖：

- 纯函数：规范化、逐字/忽略标点等价、编辑相似度、3-gram Jaccard、拒答与结构签名、`pairMetrics`、Wilson 区间；
- 判定：INSUFFICIENT / FAIL / WARN / PASS，标点差异不误判 FAIL，矛盾评审被排除；
- 语料：内置语料合法、JSONL 校验（未知字段/缺 prompt/非法 JSON/空文件）、金标各类型；
- 评审：提示词结构、围栏与全角 JSON 解析、截断与非法输出；
- 端到端（mock http 服务，不走网络）：两目标不一致 → FAIL；两端一致 → PASS 且金标 100%、评审 24 次调用且顺序一致；文件语料 → INSUFFICIENT；非法计划（同目标、缺评审、跨会话、超评审上限、文件不存在）被拒；CSV 不含回答文本、JSON 完整。

运行：`node --test --test-concurrency=1 test/*.test.mjs` → 39 tests / 39 pass（含原 21 个压测用例）。