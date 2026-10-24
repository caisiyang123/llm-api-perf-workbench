# EvalScope perf 深度分析（移植依据）

分析对象：`modelscope/evalscope`（Apache-2.0）的 `evalscope perf` 子命令，源码快照在 `.ref/evalscope/`（浅克隆，main 分支）。本文只记录**影响指标正确性**的实现细节，以及移植到本工作台时保留/丢弃了什么。

## 1. 为什么选它作为测量内核

压测工具大致分三类：

| 类别 | 代表 | 问题 |
|---|---|---|
| HTTP 压测器 | ab、wrk、vegeta、k6、Locust | 只懂 HTTP 状态码与字节数，不懂 SSE 流、TTFT、token；对 LLM 的指标几乎全错 |
| LLM 专用压测 | vLLM `benchmarks/serve.py` / `vllm bench`、EvalScope `perf`、NVIDIA AIPerf | 懂 SSE 与 token，但各自绑定框架或部署形态 |
| 自研脚本 | 各家 demo | 口径不统一、P99 实现随意、warmup 与分母定义含糊，无法横向比较 |

选择 EvalScope perf 的原因：

1. **指标定义写清楚了**，并且和 vLLM bench 同源（绝对时间调度、Poisson 开环、按首帧算 TTFT）。
2. **不绑定推理引擎**：只要能说 OpenAI 兼容协议就能压，适合「同一套脚本对比多家云厂商」。
3. **边界处理成熟**：流式增量解码、`data:` 多前缀、`[DONE]`、200 响应里的 in-band error、warmup 与全局时间窗、流式/非流式分母分离、NaN 不参与分位数排序。
4. 它是 Python + aiohttp 的**独立 CLI**，代码是能读懂的直白实现，适合把「测量语义」而不是「运行时」搬走。

不直接调用它的原因：桌面插件不应要求用户装 Python 环境；CLI 的输出面（终端表格、HTML、SQLite）也无法嵌进工作台面板。因此本工作台是**重写执行层、对齐测量层**。

## 2. 模块地图

```
evalscope/perf/
├── main.py                     入口：run_one_benchmark / run_multi_benchmark / run_perf_benchmark
├── arguments.py                CLI 参数与校验（默认值、互斥规则、sla_auto_tune）
├── core/
│   ├── benchmark.py            调度器装配、队列消费、进度
│   ├── strategies/
│   │   ├── closed_loop.py      闭环：信号量 + 可选 Poisson 发车 + 共享 warmup
│   │   └── open_loop.py        开环：Poisson 到达 + 绝对时间表
│   ├── http_client.py          aiohttp 客户端、trace 打点、失败记录、test_connection
│   └── ...
├── plugin/api/
│   ├── base.py                 build_request / parse_responses 抽象
│   ├── default_api.py          SSE 解析与首帧打点（非 OpenAI 专用路径）
│   └── openai_api.py           OpenAI 兼容：stream_options.include_usage、usage 解析
└── utils/
    ├── benchmark_util.py       BenchmarkData → MetricsAccumulator → BenchmarkMetrics
    ├── db_util.py              SQLite 落库、calculate_percentiles/get_percentile_results
    ├── perf_constants.py       PercentileMetrics 等列名常量
    └── report/                 HTML/图表/摘要
```

## 3. 执行链

```
arguments.py 解析并校验
  → main.run_one_benchmark
    → 构造 API plugin（default_api / openai_api）
    → AioHttpClient（total/connect/read timeout）
    → strategy（closed_loop | open_loop）
      → 请求体按 dataset 生成，warmup 排在前面
      → 逐条 dispatch（闭环受信号量约束；开环按绝对时间表）
        → plugin.process_request → 流式逐帧解析
          → BenchmarkData{start_time, completed_time, first_chunk_latency, chunk_times, tokens…}
      → 完成队列 queue
    → MetricsAccumulator.update(data, plugin)   # 每完成一条累加
    → accumulator.to_result()                   # 回合结束求均值/QPS/吞吐
    → db_util.get_percentile_results()          # 从 SQLite 读原始样本算分位数
    → summary_result / report
```

本工作台的对应实现：`dsh/engine/scheduler.mjs`（两种 loop）→ `dsh/engine/http.mjs`（Node http/https + 增量 SSE）→ `dsh/engine/metrics.mjs`（accumulator + 分位数）→ `dsh/engine/runner.mjs`（回合编排、持久化、判定）。

## 4. 指标公式（逐项对照）

`BenchmarkData.finalize`（`benchmark_util.py:102`）：

```python
if self.completion_tokens > 1:
    self.time_per_output_token = (self.query_latency - self.first_chunk_latency) / (self.completion_tokens - 1)
self.inter_chunk_latency = [t2 - t1 for t1, t2 in zip(self.chunk_times[:-1], self.chunk_times[1:])]
```

- `query_latency = completed_time - start_time`。
- `first_chunk_latency` 只在**携带可观测输出**的帧上打点；纯 role 帧、空 delta、心跳帧不算首帧。
- 单 token 回复没有 decode 阶段，因此不产生 TPOT（分母为 0），accumulator 也不把它计入 TPOT 分母。

`MetricsAccumulator.update`（`benchmark_util.py:253`）：

- `if data.is_warmup: return` —— warmup 在所有指标里被剔除，但**仍然参与全局时间窗之外的记账**（实际是先 return，再 `_update_wall_time` 也不会执行，所以 warmup 不撑大 RPS 分母）。这一点和「warmup 只暖机、不污染 QPS」的直觉一致。
- `n_total` 包含失败请求；`n_success` 只加成功请求。
- `if data.is_stream:` 单独累加 `total_first_chunk_latency_stream`；`completion_tokens > 1` 才累加 `total_time_per_output_token_stream`（`benchmark_util.py:294-300`）。

`to_result`（`benchmark_util.py:352`）：

```python
n = self.n_success
t = self.wall_time
qps = _safe_div(n, t)
avg_first_chunk_latency = total_first_chunk_latency_stream / n_stream_success   # 有流式成功请求时
avg_time_per_output_token = total_time_per_output_token_stream / n_stream_tpot  # 同上
avg_output_token_throughput = total_completion_tokens / t
avg_total_token_throughput = (total_prompt_tokens + total_completion_tokens) / t
```

要点：

- **QPS 与吞吐的分子都是成功请求**，分母是墙钟 `wall_time`；失败请求只影响 `success_rate`，不稀释吞吐。
- 流式/非流式分母分离：非流式请求的 `first_chunk_latency == query_latency`、TPOT 为 0，如果混进流式均值会系统性抬高 TTFT、压低 TPOT。纯非流式运行则回退到全体分母，保持旧行为。
- `wall_time`（`benchmark_util.py:243`）取 `max(completed_time) - min(start_time)`，无有效时间区间（`start_time <= 0` 或完成早于开始）的记录被跳过；无数据时返回 `1.0` 防止除零。
- 所有除零走 `_safe_div(..., default=-1)`，于是「不适用」统一表现为 `-1`。报告层再翻译成 `—` / `N/A`。本工作台保留了 `-1` 哨兵。

## 5. 两种调度语义

### 闭环（`closed_loop.py`）

- 信号量上限 = `parallel`（并发档位）；`in_flight_task_multiplier`（默认 2，`arguments.py:231`）给「已排队但未发出」留余量，避免发车器被慢响应卡住。
- 可选 `rate` 让发车也走 Poisson，但**并发上限仍然是硬约束**：既能压到达率，也不会瞬时打爆。
- **warmup 与正式请求共享同一个信号量和发车循环，没有屏障**（`closed_loop.py:51-61` 的注释解释了原因）：如果等 warmup 全部结束再开始正式请求，服务端占用会被抽空，第一批正式请求又会同时涌入——这正是 warmup 想避免的。因此 warmup 完成一条就释放一个槽位，正式请求按顺序补位。
- `duration` 的计时窗口从**第一条真正发出的正式请求**开始，而不是从 warmup 开始（`closed_loop.py:112-128`）。

### 开环（`open_loop.py`）

- 无信号量，请求按到达时刻发出，不管前一条是否完成；用来模拟真实流量。
- 到达时刻**预计算**：先按指数分布抽 n 个间隔累加成绝对时间戳，再整体缩放使总时长恰好 `n / rate`（`open_loop.py:66` 的长注释解释了为什么不能用相对 `sleep`：事件循环抖动会累积漂移，实测有效速率会掉到目标的 70–80%）。绝对时间表自带追赶：晚到 Δ 后下一条的 sleep 自动变短。
- warmup 是**独立的第一阶段**：同样按目标速率排程，忽略 `duration`，全部完成后再进入正式阶段并锚定计时窗口。
- `--rate` 与 `--parallel` 在开环模式下互斥/无效（`arguments.py:723-743` 的校验）。

## 6. SSE、HTTP 与失败模型

- 增量解码：`StreamedResponseHandler.add_chunk`（`default_api.py:94`）用增量 UTF-8 解码器，处理跨 chunk 的多字节字符和跨包截断的 `data:` 行；`_extract_sse_payload`（`:70`）只剥一层 `data:` 前缀，容忍 `data:data:` 这类代理叠加。
- `stream_options: {include_usage: true}` 只在流式时注入（`openai_api.py:149`），否则服务端不会回 usage。
- usage 解析（`openai_api.py:168-206`）：流式取最后一帧的 `usage`；`prompt_tokens` 与 `completion_tokens` 分别判断，避免「completion_tokens 缺失就把有效 prompt_tokens 一起丢掉」。没有 usage 时才尝试解析文本；解析不出就报错并提示用户换支持 usage 的接口。
- 失败判定：非 2xx、连接/读/总超时、异常都记录为 `success=False` 并保留错误文本；**200 响应体里的 `{"error": ...}` 也算失败**（这是流式代理最常见的坑）。
- 压测路径**不重试**（`http_client.py:74-101`：异常/超时直接 `_failure_record`），失败请求进入 `n_total` 但不进入 `n_success`。只有 `test_connection` 会重试：4xx 直接判定配置错误，其余每 10 秒重试直到 `total_timeout`（`http_client.py:152-199`）。

## 7. 分位数

`calculate_percentiles`（`db_util.py:148`）：

```python
idx = max(0, math.ceil(len(data) * percentile / 100) - 1)   # percentile < 100
value = data[-1] if percentile >= 100 else data[idx]
```

- 最近秩，不是线性插值；`0` 与 `100` 分别映射到 min/max，标签顺序是 `['min','1%','5%','10%','25%','50%','75%','90%','95%','99%','max']`（`db_util.py:299`）。
- 每个指标先剔除 NaN 再排序（`db_util.py:304` 的注释：`sort()` 无法排序 NaN，会打乱整列），因此「没有 decode 阶段的回复」不会把 TPOT 的 P99 变成 NaN 或 0。
- 分位数从**落库的原始样本**重算，而不是从均值反推——这是能给出尾延迟的前提。

本工作台的实现：`metrics.mjs` 的 `nearestRank` / `computePercentiles` / `buildPercentileTable`，11 个标签、同样的剔除 NaN 与最近秩规则；另加了每档的 token 来源计数，便于判断分位数是否建立在估算 token 上。

## 8. 容易踩的坑（分析中确认的）

1. **把「最大并发」当成一个可测数字**：EvalScope 本身也只给并发阶梯曲线；`--sla-auto-tune` 是在阶梯上搜索满足 SLO 的最大档位。不设 SLO 就没有「最大并发」，只有「吞吐峰值」和「曲线形状」。
2. **用总请求数做 QPS 分母**：必须用墙钟窗口，否则预热、慢尾、空闲间隔都会被算进去。
3. **非流式混入 TTFT**：会让 TTFT 变成「全延迟」，TPOT 变成 0。
4. **warmup 建屏障**：服务端占用被抽空，第一批正式请求相当于冷启动，TTFT 偏高。
5. **相对 sleep 发车**：事件循环抖动累积，实际速率低于目标；必须用绝对时间表。
6. **在均值上算 P99**：分位数不可由均值/标准差反推；必须用原始样本。
7. **token 数不标来源**：估算 token 撑起来的吞吐不能当验收数据。
8. **200 里的 error 被当成功**：成功率虚高。

## 9. 移植清单

### 保留（语义一致，Node 重写）

| EvalScope | 本工作台 |
|---|---|
| `BenchmarkData` 时间字段与 finalize 公式 | `metrics.mjs: createSample/finalizeSample/estimateTokens` |
| `MetricsAccumulator.update/to_result` | `MetricsAccumulator`（同样跳过 warmup、流式分母、`-1` 哨兵） |
| `calculate_percentiles` + 11 标签 + NaN 剔除 | `nearestRank/computePercentiles/buildPercentileTable` |
| `closed_loop.py` 信号量、`in_flight_task_multiplier`、共享 warmup、duration 锚点 | `scheduler.mjs: runClosedLoop` |
| `open_loop.py` Poisson 预计算 + 缩放 + 绝对时间调度 + warmup 阶段 | `scheduler.mjs: poissonArrivalTimes/runOpenLoop` |
| `StreamedResponseHandler` 增量解码、`data:` 剥离、`[DONE]` | `sse.mjs: StreamedResponseHandler/extractSsePayload` |
| `stream_options.include_usage`、usage 优先、文本兜底 | `http.mjs: applyUsage/estimate` |
| 200-in-band error = 失败、超时/连接失败记录 | `http.mjs: postOnce` 失败分支 |
| `test_connection` 的 4xx 语义 | `runner.testConnection`（单次探测 + 明确错误） |

### 未移植（明确记录）

| 能力 | 原因 |
|---|---|
| GPU 显存/利用率、PD 分离指标、投机解码接受长度 | 需要在本机推理进程内采样；远程 API 压测拿不到 |
| 多轮对话、trace 回放、embedding/rerank 指标 | 本工作台定位是单轮服务端性能基线 |
| `--sla-auto-tune` 自动调参 | 交互式面板更适合「先测曲线，再由人设定 SLO」，自动调参会静默消耗配额 |
| tokenizer 精确计数 | 避免为插件引入模型词表依赖；改用字符估算并显式标记 |
| SQLite/HTML/多图表报告 | 改为 ndjson 原始样本 + JSON/CSV/Markdown 导出，面板内绘图 |
| 重试与断点续跑 | 压测要的是「一次真实测量」，重试会掩盖失败率 |

### 新增（EvalScope 没有直接对应）

- `requests/min` 与 `output tokens/min`：对应「每分钟处理事务 / 每分钟输出 token」的验收口径。
- 每档 `token_sources{usage,estimate,missing}`、`sample_counts{warmup,measured,failed}`：让「这份数字可不可信」变成可检查的字段。
- 运行级判定 `analysis.bottleneck{status:saturated|rising|single_point|no_data}` 与 `analysis.slo.checks[]`：把「最大并发」从口号变成可复核的判定过程。
- 样本 ndjson 保留 warmup 行并打 `is_warmup`，指标剔除但证据可追溯。