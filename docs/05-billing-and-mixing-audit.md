# 计费审计与混推理审计（v1.3.1）

> 这份文档说明两类「掺水」能测到什么程度、怎么测、哪些结论不能下。测试方案本身是抽样，不是司法鉴定；计费审计也不是对账单审计。

## 1. 两类掺水与可证程度

| 类型 | 典型手法 | 可观测证据 | 结论强度 |
|---|---|---|---|
| 计费掺水 | 输入/输出 token 虚高；缓存命中率不兑现；隐藏倍率 | 服务端 usage、缓存字段、同题 A/B 比值、按价目表复算成本 | 有官方 B 时可判「嫌疑」；A-only 只能 `INSUFFICIENT` |
| 模型掺水 | 贵模型与劣质模型按请求/时段/并发混合路由；持续降级 | 重复采样的强弱题成败混合、`system_fingerprint`、延迟/长度分布、A/B 行为差 | 只能判「有嫌疑 / 无证据 / 不确定」，不能证明权重 |

关键限制先写在前面：

1. **没有官方 tokenizer，就无法用本地估算精确对账**。本地 token 估算只能发现「用量缺失或离谱」，不能作为虚高判据。
2. **计费审计需要目标 B（官方同模型）**。同一提示词在 A/B 两端返回的 usage 才有可比性；没有 B 时方案直接拒绝启动。
3. **缓存是 best-effort**，按账号/组织隔离，受 TTL 与最小前缀长度影响；命中率低本身不是造假，必须同账号、同时间窗、同前缀对比。
4. **路由混合与合法负载均衡/限流 fallback/灰度不可区分**；报告只能写「本次抽样下存在混合行为嫌疑」。
5. **账面成本 ≠ 厂商账单**：重试双计费、汇率、最低消费、隐藏倍率都不在 usage 里。

## 2. 计费审计方案 `billing-audit`

**执行条件**：目标 A（待测）+ 目标 B（官方参考）必须同时选择；目标 B 缺失时 API 返回「需要目标 B」并拒绝启动。

**探针设计**（8 道，每题重复 2 次，共 32 次请求）：

- 3 道短/中/长普通题（长度斜率）；
- 2 道中长题（约 300/1000 字），用于排除「只对短 prompt 加固定头」的假象；
- 3 道共享长前缀（约 2.6k 字符，超过常见缓存门槛 1024 token）的不同尾题，用于缓存命中对比。

**指标与判定**：

- 输入比值 = A.`prompt_tokens` / B.`prompt_tokens`；输出比值 = A.`completion_tokens` / B.`completion_tokens`。
- 仅使用双方都声称 `token_source = usage` 的配对；配对 < 6 → `INSUFFICIENT`。
- 输入或输出比值中位数 ≥ 1.15 → `SUSPECT`；≥ 1.08 → `WARN`；否则继续看缓存与成本。
- 缓存命中率 = `cached_tokens > 0` 的成功响应比例；A ≤ 20% 且 B ≥ 50% → 缓存嫌疑（只对双方都上报缓存字段时生效）。
- **账面成本复核**：用 B 的 usage × A 的价目表算「同任务应有成本」，与实际 A 成本相比；比值 ≥ 1.15 → `SUSPECT`。该比值假设两端 tokenizer 与请求模板一致，报告会强制标注这一假设。

判定输出同时带：配对数、不足数、比值中位数、虚高配对数、缓存 A/B、成本实际/应有/比值、前 8 条逐题对账与 caveat。

## 3. 价目表与成本模型

价目表挂在「目标配置」里，由人工填写；Agent 只读。字段：

```json
{
  "enabled": true,
  "currency": "CNY",
  "input": 2.0,
  "output": 8.0,
  "cached_input": 0.5,
  "vendor_discount_pct": 10,
  "batch_discount_pct": 50,
  "timezone": "Asia/Shanghai",
  "windows": [
    { "label": "闲时", "weekdays": [1,2,3,4,5,6,7], "start": "00:00", "end": "08:00", "multiplier": 0.5 }
  ]
}
```

- 单价单位固定为**每 1,000,000 token**；缓存命中价为空时按输入价计。
- 时段窗口按目标时区计算，可配置星期几与起止时间；重叠窗口倍率相乘；未命中任何窗口时倍率为 1。
- 成本公式：

```text
单请求账面成本 =
  (prompt_tokens − cached_tokens) × 输入价
  + cached_tokens × 缓存命中价
  + completion_tokens × 输出价
  × 时段倍率
  × (1 − 厂商折扣%)
  × (1 − 批量折扣%)      // 仅当本次运行勾选「按批量任务计价」
```

- 批量任务价是独立计费通道，不是时段；运行时勾选后应用 `batch_discount_pct`。
- 报告保存**价目表快照**（含币种、折扣、时区、窗口），保证事后可复现。
- 成本指标：总账面成本、每请求、每可判定题、**每通过题**、通过题/元。样本不足时不要拿单点比值做采购决策。

## 4. 混推理审计方案 `mix-audit`

**执行条件**：目标 A 必选，B 建议；`temperature` 为 0 时引擎自动改用 0.7 并记录 `temperature_defaulted`；重复次数至少 3（方案默认 8 道 × 3 次 = 24 次请求）。

**探针设计**：

- 4 道「强题」：多步算术、逻辑陷阱、代码语义、分数化简；
- 4 道「对照题」：1+1、元素名、大小写、月份数；
- 每题重复 3–5 次，逐样本按金标判分，而不是「任一重复通过即算通过」。

**判定**：

- 可判样本 < 12 或重复 < 3 → `INSUFFICIENT`；
- B 自身强题混合 ≥ 2 → `INCONCLUSIVE`（不能把 A 的混合归因为偷换）；
- A 强题混合 ≥ 2 且对照题通过率 ≥ 90% → `SUSPECT`；
- A 强题混合 = 1 → `INCONCLUSIVE`；
- 其余 → `NO_EVIDENCE`（不排除低比例路由或按时间/并发切换）。

同时记录：每探针通过与可判数、strong/control、混合标记、通过率、延迟 CV、输出长度范围、`reported_model` 与 `system_fingerprint` 集合。

## 5. 结论口径

- 计费审计 `SUSPECT` 时总判定置 `FAIL`；`WARN` 时把 PASS 拉成 WARN。
- 混推理审计 `SUSPECT` 时总判定置 WARN（不是 FAIL，因为存在合法路由解释）。
- 审计状态与质量维度分开显示；`PASS/NO_EVIDENCE` 只代表「本次样本未发现」，不是「没有掺水」。
- 所有结论必须带样本量、token 来源、未测量维度；不能写成官方评分或计费鉴定。

## 6. 参考

- OpenAI API usage / prompt caching：`prompt_tokens_details.cached_tokens`、缓存最小前缀与 TTL 说明。
- Anthropic prompt caching：`cache_read_input_tokens`、`cache_creation_input_tokens` 与 5 分钟 TTL。
- IMC 2026「API gateway 行为一致性」研究：行为证据与权重证明分离。
- HELM：多维、标准化、可复现的评测骨架。
- EvalScope / lm-evaluation-harness：参数固定、样本量与可复现性。
- vLLM `system_fingerprint` 与 model-fingerprint 类工作：只能作辅助证据。
