/**
 * Workbench business API — the single implementation shared by the HTTP routes
 * (human UI) and the Agent tool. Keeping one implementation is what prevents the
 * panel and the model from drifting into two different answers for the same run.
 */

import { LIMITS, maskTarget, normalizeTarget } from './engine/runner.mjs';
import { PARITY_LIMITS, PARITY_THRESHOLDS } from './engine/parity.mjs';
import { PLAN_LIMITS, PLAN_THRESHOLDS, STANDARD_PLANS, DIMENSION_META } from './engine/plans.mjs';
import { costOfUsage } from './engine/pricing.mjs';

const REPORT_LIMIT = 24000;

function p99(round, metric) {
  if (!round.percentiles) return null;
  const index = round.percentiles.percentiles.indexOf('99%');
  if (index < 0) return null;
  const column = round.percentiles.columns[metric];
  if (!column) return null;
  return column[index];
}

function pickRoundLabel(round) {
  return round.parallel != null ? `${round.parallel} 并发` : `${round.rate} req/s`;
}

function headlineOf(run) {
  const rounds = (run.rounds || []).filter((round) => round.summary);
  if (!rounds.length) return null;
  const last = rounds[rounds.length - 1];
  return {
    round: last.key,
    qps: last.summary.qps,
    success_rate: last.summary.success_rate,
    avg_ttft_ms: last.summary.avg_ttft >= 0 ? last.summary.avg_ttft * 1000 : null,
    p99_ttft_ms: p99(last, 'TTFT (ms)'),
    output_tokens_per_second: last.summary.output_token_throughput,
    output_tokens_per_minute: last.summary.output_tokens_per_minute,
  };
}

export function summarizeRun(run) {
  return {
    id: run.id,
    created_at: run.created_at,
    updated_at: run.updated_at,
    status: run.status,
    target: run.target,
    plan: {
      mode: run.plan?.mode,
      list: run.plan?.list,
      number: run.plan?.number,
      warmup: run.plan?.warmup,
      stream: run.plan?.stream,
      max_tokens: run.plan?.max_tokens,
      duration_sec: run.plan?.duration_sec,
      slo: run.plan?.slo,
    },
    round_count: (run.rounds || []).length,
    progress: run.progress || null,
    error: run.error,
    headline: headlineOf(run),
    bottleneck: run.analysis?.bottleneck?.status || null,
    slo_max: run.analysis?.slo?.max_within_slo ?? null,
  };
}

export function detailRun(run) {
  return {
    ...summarizeRun(run),
    rounds: (run.rounds || []).map((round) => ({
      key: round.key,
      parallel: round.parallel,
      rate: round.rate,
      number: round.number,
      warmup: round.warmup,
      dispatched: round.dispatched ?? null,
      skipped: round.skipped ?? null,
      cancelled: Boolean(round.cancelled),
      started_at: round.started_at,
      finished_at: round.finished_at,
      summary: round.summary,
      percentiles: round.percentiles,
      sample_counts: round.sample_counts,
      token_sources: round.token_sources,
      error: round.error,
    })),
    analysis: run.analysis || null,
    plan: run.plan,
  };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function roundsToCsv(run) {
  const header = [
    'run_id',
    'round',
    'concurrency',
    'rate_req_s',
    'requests',
    'success_rate_pct',
    'qps',
    'requests_per_minute',
    'avg_latency_ms',
    'p99_latency_ms',
    'avg_ttft_ms',
    'p99_ttft_ms',
    'avg_tpot_ms',
    'p99_tpot_ms',
    'output_tps',
    'output_tpm',
    'total_tps',
    'avg_prompt_tokens',
    'avg_completion_tokens',
    'token_source_usage',
    'token_source_estimate',
    'token_source_missing',
  ];
  const lines = [header.join(',')];
  for (const round of run.rounds || []) {
    if (!round.summary) continue;
    const s = round.summary;
    lines.push(
      [
        run.id,
        round.key,
        round.parallel ?? '',
        round.rate != null && round.rate > 0 ? round.rate : '',
        s.total_requests,
        s.success_rate,
        s.qps,
        s.requests_per_minute,
        s.avg_latency * 1000,
        (p99(round, 'Latency (s)') || 0) * 1000,
        s.avg_ttft * 1000,
        p99(round, 'TTFT (ms)'),
        s.avg_tpot * 1000,
        p99(round, 'TPOT (ms)'),
        s.output_token_throughput,
        s.output_tokens_per_minute,
        s.total_token_throughput,
        s.avg_prompt_tokens,
        s.avg_completion_tokens,
        round.token_sources?.usage ?? '',
        round.token_sources?.estimate ?? '',
        round.token_sources?.missing ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

function reportMarkdown(run) {
  const lines = [];
  const plan = run.plan || {};
  const analysis = run.analysis || {};
  lines.push(`# 大模型 API 服务质量压测报告`);
  lines.push('');
  lines.push(`- 运行 ID：\`${run.id}\``);
  lines.push(`- 目标：${run.target?.name || '-'}（${run.target?.base_url || '-'}）`);
  lines.push(`- 模型：${run.target?.model || '-'}`);
  lines.push(`- 端点：${run.target?.endpoint === 'completions' ? '/completions' : '/chat/completions'}，${plan.stream === false ? '非流式' : '流式 SSE'}`);
  lines.push(`- 模式：${plan.mode === 'open' ? '开环（泊松到达）' : '闭环（并发上限）'}；档位：${(plan.list || []).join(' / ')}；每档 ${plan.number} 条请求`);
  lines.push(`- 预热：每档 ${plan.warmup ?? 0}（不计入指标）；最大输出：${plan.max_tokens} tokens`);
  lines.push(`- 状态：${run.status}；创建时间：${run.created_at}`);
  lines.push('');
  lines.push('## 口径说明');
  lines.push('');
  lines.push('- **TTFT**：从发出请求到收到第一个「携带可观测输出」的流式帧，含 DNS/连接/排队/预填充；不包含客户端渲染时间。');
  lines.push('- **TPOT / ITL**：TPOT =（总延迟 − TTFT）/（输出 token 数 − 1）；ITL 为相邻输出帧间隔，用于观察输出抖动。');
  lines.push('- **RPS / tok/s**：分母统一为「首条请求发出 → 最后一条请求完成」的墙钟时间，与 EvalScope / vLLM bench 一致。');
  lines.push('- **P99**：最近秩（nearest-rank）分位数，不是线性插值；样本量不足时 P99 不具统计意义。');
  lines.push('- **最大并发**：不是单次测得的数值，而是「吞吐不再随并发上升」与「SLO 仍满足」两者共同约束的上界。');
  lines.push('');
  lines.push('## 分档结果');
  lines.push('');
  lines.push('| 档位 | 请求数 | 成功率 | RPS | 输出 tok/s | 输出 tok/min | TTFT 均值 (ms) | TTFT P99 (ms) | TPOT 均值 (ms) | 延迟 P99 (ms) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const round of run.rounds || []) {
    if (!round.summary) continue;
    const s = round.summary;
    lines.push(
      `| ${pickRoundLabel(round)} | ${s.total_requests} | ${s.success_rate.toFixed(1)}% | ${s.qps.toFixed(2)} | ${s.output_token_throughput.toFixed(1)} | ${s.output_tokens_per_minute.toFixed(0)} | ${(s.avg_ttft * 1000).toFixed(0)} | ${(p99(round, 'TTFT (ms)') || 0).toFixed(0)} | ${(s.avg_tpot * 1000).toFixed(1)} | ${((p99(round, 'Latency (s)') || 0) * 1000).toFixed(0)} |`,
    );
  }
  lines.push('');
  lines.push('## 判定');
  lines.push('');
  if (analysis.bottleneck) {
    lines.push(`- 瓶颈：${analysis.bottleneck.message}`);
    if (analysis.bottleneck.peak) {
      lines.push(`- 吞吐峰值：${analysis.bottleneck.peak.qps.toFixed(2)} req/s @ ${analysis.bottleneck.peak.value}（${analysis.bottleneck.peak.dimension === 'concurrency' ? '并发' : 'req/s 到达率'}）`);
    }
    if (analysis.bottleneck.latency_amplification) {
      lines.push(`- 末档/首档延迟放大：${analysis.bottleneck.latency_amplification.toFixed(2)}×`);
    }
  } else {
    lines.push('- 尚无足够样本做瓶颈判定。');
  }
  if (analysis.slo) {
    lines.push(`- SLO：${analysis.slo.message}`);
    for (const check of analysis.slo.checks) {
      if (!check.ok) lines.push(`  - ${check.value}（${check.dimension === 'concurrency' ? '并发' : 'req/s'}）未达标：${check.failures.join('；')}`);
    }
  } else {
    lines.push('- SLO：本次未设置阈值，因此没有「最大可承载并发」结论。');
  }
  lines.push('');
  lines.push('## 数据可信度');
  lines.push('');
  const usage = (run.rounds || []).reduce((sum, round) => sum + (round.token_sources?.usage || 0), 0);
  const estimate = (run.rounds || []).reduce((sum, round) => sum + (round.token_sources?.estimate || 0), 0);
  const missing = (run.rounds || []).reduce((sum, round) => sum + (round.token_sources?.missing || 0), 0);
  const total = usage + estimate + missing;
  lines.push(`- token 来源：服务端 usage ${usage} 条，估算 ${estimate} 条，缺失 ${missing} 条，合计 ${total} 条（估算值不可用于对外报价或验收）。`);
  lines.push('- 预热请求已排除在指标之外，但会保留在样本文件中作为执行证据。');
  lines.push('- 本机单进程发压受本机 CPU/网卡与出口带宽影响；跨公网测量包含本机到服务端的网络路径，不代表服务端内部时延。');
  lines.push('- 未测量：队列等待与服务端预填充的拆分、reasoning token 与可见 token 的区分、多轮与缓存命中、GPU 显存与调度指标。');
  lines.push('- 结论仅适用于本次时间窗口内的该端点与该模型；供应商同区域不同时段可能不同。');
  return lines.join('\n').slice(0, REPORT_LIMIT);
}

export function summarizeParity(run) {
  return {
    id: run.id,
    kind: 'parity',
    created_at: run.created_at,
    updated_at: run.updated_at,
    status: run.status,
    plan: {
      targets: run.plan?.targets,
      dataset: run.plan?.dataset,
      repeats: run.plan?.repeats,
      temperature: run.plan?.temperature,
      seed: run.plan?.seed,
      max_tokens: run.plan?.max_tokens,
      judge: run.plan?.judge,
    },
    prompt_count: run.prompt_count,
    pair_count: run.pair_count,
    progress: run.progress || null,
    error: run.error,
    verdict: run.summary?.parity?.verdict || null,
    quality_verdict: run.summary?.quality?.quality_verdict || null,
    headline: run.summary
      ? {
          pairs: run.summary.parity?.pairs,
          normalized_rate: run.summary.parity?.normalized?.rate,
          exact_rate: run.summary.parity?.exact?.rate,
          mean_edit: run.summary.parity?.mean_edit,
          gold_a: run.summary.quality?.gold?.a?.rate ?? null,
          gold_b: run.summary.quality?.gold?.b?.rate ?? null,
        }
      : null,
  };
}

function pct(rate) {
  return rate == null || !Number.isFinite(rate) ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function ci(interval) {
  if (!interval || interval.low == null) return '—';
  return `${pct(interval.low)}–${pct(interval.high)}`;
}

export function parityReportMarkdown(run) {
  const summary = run.summary || {};
  const parity = summary.parity || {};
  const quality = summary.quality || {};
  const plan = run.plan || {};
  const lines = [];
  lines.push('# 一致性校验报告');
  lines.push('');
  lines.push(`- 运行：\`${run.id}\``);
  lines.push(`- 时间：${run.created_at}（状态：${run.status}）`);
  lines.push(`- 目标 A（基准）：${plan.targets?.a?.name || '—'} · ${plan.targets?.a?.model || '—'} · ${plan.targets?.a?.host || ''}`);
  lines.push(`- 目标 B（待核对）：${plan.targets?.b?.name || '—'} · ${plan.targets?.b?.model || '—'} · ${plan.targets?.b?.host || ''}`);
  lines.push(`- 提示词集：${plan.dataset?.source === 'file' ? `文件 ${plan.dataset.file_path}` : '内置一致性语料'}（${run.prompt_count} 条 × 重复 ${plan.repeats} 次 = ${run.pair_count} 对）`);
  lines.push(`- 采样：temperature=${plan.temperature}，seed=${plan.seed}，max_tokens=${plan.max_tokens}，非流式一次判读`);
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(`- 一致性判定：**${parity.verdict?.status || '—'}** — ${parity.verdict?.reason || ''}`);
  if (quality.quality_verdict) lines.push(`- 质量判定：**${quality.quality_verdict.status}** — ${quality.quality_verdict.reason || ''}`);
  if (plan.judge?.enabled) {
    lines.push(`- 评审模型：${plan.judge.target?.name || '—'}（${plan.judge.target?.model || '—'}）${plan.judge.self_judging ? '；注意：评审目标与被测目标相同，存在自我偏好风险' : ''}${plan.judge.swap ? '；已做答案顺序互换校验' : '；未做顺序互换校验'}`);
  }
  lines.push('');
  lines.push('## 配对一致性指标');
  lines.push('');
  lines.push('| 指标 | A↔B | 95% 置信区间 | 有效样本 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(`| 完全一致 | ${pct(parity.exact?.rate)} | ${ci(parity.exact?.wilson)} | ${parity.pairs ?? 0} |`);
  lines.push(`| 规范化一致（大小写/空白/全半角） | ${pct(parity.normalized?.rate)} | ${ci(parity.normalized?.wilson)} | ${parity.pairs ?? 0} |`);
  lines.push(`| 忽略标点与空白后一致 | ${pct(parity.tight?.rate)} | ${ci(parity.tight?.wilson)} | ${parity.pairs ?? 0} |`);
  lines.push(`| 结构一致（JSON/代码块/拒答/列表） | ${pct(parity.structure?.rate)} | ${ci(parity.structure?.wilson)} | ${parity.pairs ?? 0} |`);
  lines.push('');
  lines.push('| 相似度 | A↔B |');
  lines.push('| --- | --- |');
  lines.push(`| 平均编辑相似度（0–1） | ${parity.mean_edit == null ? '—' : parity.mean_edit.toFixed(3)} |`);
  lines.push(`| 中位编辑相似度 | ${parity.median_edit == null ? '—' : parity.median_edit.toFixed(3)} |`);
  lines.push(`| 平均 3-gram Jaccard | ${parity.mean_jaccard == null ? '—' : parity.mean_jaccard.toFixed(3)} |`);
  lines.push(`| 中位长度比（短/长） | ${parity.median_length_ratio == null ? '—' : parity.median_length_ratio.toFixed(3)} |`);
  lines.push(`| 平均 completion token 差 | ${parity.token_delta_mean == null ? '—' : parity.token_delta_mean.toFixed(1)} |`);
  lines.push(`| 平均延迟 A / B | ${parity.latency_ms?.a == null ? '—' : `${Math.round(parity.latency_ms.a)} ms`} / ${parity.latency_ms?.b == null ? '—' : `${Math.round(parity.latency_ms.b)} ms`} |`);
  lines.push('');
  lines.push('## 金标与评审质量');
  lines.push('');
  if (quality.gold) {
    lines.push('| 目标 | 金标通过 | 通过率 | 95% 置信区间 | 未通过样本 |');
    lines.push('| --- | --- | --- | --- | --- |');
    lines.push(`| A | ${quality.gold.a?.passed}/${quality.gold.a?.graded} | ${pct(quality.gold.a?.rate)} | ${ci(quality.gold.a?.wilson)} | ${(quality.gold.a?.failed_ids || []).join(', ') || '—'} |`);
    lines.push(`| B | ${quality.gold.b?.passed}/${quality.gold.b?.graded} | ${pct(quality.gold.b?.rate)} | ${ci(quality.gold.b?.wilson)} | ${(quality.gold.b?.failed_ids || []).join(', ') || '—'} |`);
  }
  if (quality.judge) {
    lines.push('');
    lines.push(`- 评审次数：${quality.judge.calls}（有效 ${quality.judge.judged} 对；A 胜 ${quality.judge.wins_a}，B 胜 ${quality.judge.wins_b}，平 ${quality.judge.ties}，顺序不一致 ${quality.judge.inconsistent}，评分自相矛盾 ${quality.judge.contradictory || 0}）`);
    lines.push(`- 平均评分：A ${quality.judge.mean_score_a == null ? '—' : quality.judge.mean_score_a.toFixed(2)} / B ${quality.judge.mean_score_b == null ? '—' : quality.judge.mean_score_b.toFixed(2)}`);
  }
  lines.push('');
  lines.push('## 差异最大的样本');
  lines.push('');
  const diffs = summary.diffs || [];
  if (!diffs.length) lines.push('（无差异样本）');
  for (const diff of diffs) {
    lines.push(`### ${diff.prompt_id}（编辑相似度 ${diff.edit?.toFixed(3) ?? '—'}${diff.judge_winner ? `，评委 ${diff.judge_winner}` : ''}）`);
    lines.push(`- 提示词：${String(diff.prompt || '').slice(0, 160)}`);
    lines.push(`- A：${String(diff.answer_a || '').replace(/\n/g, ' ').slice(0, 240)}`);
    lines.push(`- B：${String(diff.answer_b || '').replace(/\n/g, ' ').slice(0, 240)}`);
    lines.push('');
  }
  lines.push('## 证据与局限');
  lines.push('');
  lines.push(`- 配对样本：${run.pair_count}；请求失败：A ${summary.per_target?.a?.failures ?? 0} / B ${summary.per_target?.b?.failures ?? 0}；token 来源：A ${JSON.stringify(summary.per_target?.a?.token_sources || {})} / B ${JSON.stringify(summary.per_target?.b?.token_sources || {})}。`);
  lines.push('- 原始答案已保存在本机 `parity.ndjson`（含提示词与两个回答），报告只截取差异最大的样本。');
  lines.push('- 行为一致性不是权重证明：量化、蒸馏、动态路由或缓存都可能在某些提示词上产生一致输出，也可能在另一些提示词上系统性偏离。');
  lines.push(`- 判定门槛：至少 ${PARITY_THRESHOLDS.minSamples} 对有效样本；忽略标点与空白后一致率 ≥ ${PARITY_THRESHOLDS.passTight * 100}% 且平均编辑相似度 ≥ ${PARITY_THRESHOLDS.passEdit} 才判 PASS；低于 ${PARITY_THRESHOLDS.warnTight * 100}% 判 FAIL。`);
  lines.push('- 未测量：服务端权重/量化版本、内部路由与缓存命中、训练数据差异；temperature>0 时输出天然随机，本报告默认要求 temperature=0。');
  return lines.join('\n').slice(0, REPORT_LIMIT);
}

function parityCsv(run, rows) {
  const header = [
    'run_id', 'prompt_id', 'repeat', 'order',
    'exact', 'normalized', 'tight', 'edit', 'jaccard', 'length_ratio', 'structure_same',
    'chars_a', 'chars_b', 'tokens_a', 'tokens_b', 'token_delta',
    'latency_a_ms', 'latency_b_ms', 'success_a', 'success_b',
    'judge_winner', 'judge_consistent',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = [
      run.id,
      row.prompt_id,
      row.repeat,
      row.order,
      row.metrics?.exact,
      row.metrics?.normalized,
      row.metrics?.tight,
      row.metrics?.edit,
      row.metrics?.jaccard,
      row.metrics?.length_ratio,
      row.metrics?.structure_same,
      row.metrics?.chars_a,
      row.metrics?.chars_b,
      row.metrics?.tokens_a,
      row.metrics?.tokens_b,
      row.metrics?.token_delta,
      row.a?.latency_ms,
      row.b?.latency_ms,
      row.a?.success,
      row.b?.success,
      row.judge?.verdict?.winner,
      row.judge?.consistent,
    ];
    lines.push(values.map((value) => csvEscape(value)).join(','));
  }
  return lines.join('\n');
}

export function summarizePlan(run) {
  const summary = run.summary || {};
  const verdicts = summary.verdicts || {};
  return {
    id: run.id,
    kind: 'plan',
    created_at: run.created_at,
    updated_at: run.updated_at,
    status: run.status,
    plan: {
      plan_id: run.plan?.plan_id,
      title: run.plan?.title,
      dimensions: run.plan?.dimensions,
      targets: run.plan?.targets,
      repeats: run.plan?.repeats,
      temperature: run.plan?.temperature,
      max_tokens: run.plan?.max_tokens,
      judge: run.plan?.judge,
      long_context: run.plan?.long_context,
    },
    item_count: run.plan?.item_count,
    estimate: run.estimate || null,
    progress: run.progress || null,
    error: run.error,
    verdict: verdicts.overall?.a?.status || null,
    verdict_b: verdicts.overall?.b?.status || null,
    comparison: summary.comparison?.status || null,
    pricing_mode: summary.pricing_mode || 'standard',
    billing_status: summary.billing_audit?.status || null,
    routing_status: summary.routing_audit?.status || null,
    costs: summary.costs
      ? Object.fromEntries(Object.entries(summary.costs).map(([key, cost]) => [key, cost && cost.pricing ? { ...cost, pricing: undefined } : cost]))
      : null,
    headline: summary.dimensions
      ? {
          dimensions: Object.fromEntries(Object.entries(summary.dimensions).map(([dimension, bucket]) => [
            dimension,
            {
              a: bucket.targets?.a ? { graded: bucket.targets.a.graded, passed: bucket.targets.a.passed, rate: bucket.targets.a.rate } : null,
              b: bucket.targets?.b ? { graded: bucket.targets.b.graded, passed: bucket.targets.b.passed, rate: bucket.targets.b.rate } : null,
            },
          ])),
          judge_calls: summary.judge_calls ?? 0,
          requests: summary.requests ?? 0,
          failed_requests: summary.failed_requests ?? 0,
        }
      : null,
  };
}

function verdictLabel(status) {
  if (status === 'PASS') return '通过';
  if (status === 'WARN') return '警告';
  if (status === 'FAIL') return '不通过';
  if (status === 'DIFFERENT') return '存在显著差异';
  if (status === 'NO_DIFFERENCE') return '未发现显著差异';
  return '样本不足';
}

function dimensionRowsMarkdown(summary, targetKeys) {
  const dimensions = summary.dimensions || {};
  const verdicts = summary.verdicts?.by_dimension || {};
  const lines = [];
  const header = ['维度', ...targetKeys.map((key) => `目标 ${key.toUpperCase()} 通过`), ...targetKeys.map((key) => `目标 ${key.toUpperCase()} 判定`)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const [dimension, bucket] of Object.entries(dimensions)) {
    const cells = [DIMENSION_META[dimension]?.title || dimension];
    for (const key of targetKeys) {
      const stats = bucket.targets?.[key];
      cells.push(stats ? `${stats.passed}/${stats.graded}（${pct(stats.rate)}）` : '—');
    }
    for (const key of targetKeys) {
      const verdict = verdicts[dimension]?.[key];
      cells.push(verdict ? `${verdict.status}（${verdictLabel(verdict.status)}）` : '—');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

export function planReportMarkdown(run) {
  const summary = run.summary || {};
  const plan = run.plan || {};
  const lines = [];
  const targetKeys = plan.target_b ? ['a', 'b'] : ['a'];
  lines.push('# 测试方案报告');
  lines.push('');
  lines.push(`- 运行：\`${run.id}\``);
  lines.push(`- 时间：${run.created_at}（状态：${run.status}）`);
  lines.push(`- 方案：**${plan.title || plan.standard_title || plan.plan_id}**（${plan.plan_id}，${plan.item_count} 题）`);
  lines.push(`- 目标 A（待测）：${plan.targets?.a?.name || '—'} · ${plan.targets?.a?.model || '—'} · ${plan.targets?.a?.host || ''}`);
  if (plan.target_b) lines.push(`- 目标 B（参考）：${plan.targets?.b?.name || '—'} · ${plan.targets?.b?.model || '—'} · ${plan.targets?.b?.host || ''}`);
  lines.push(`- 采样：temperature=${plan.temperature}，seed=${plan.seed}，max_tokens=${plan.max_tokens}；稳定性题重复 ${plan.repeats} 次；非流式一次判读${plan.temperature_defaulted ? '（混推理审计需要非零温度，已自动使用 0.7）' : ''}`);
  lines.push(`- 计价模式：${summary.pricing_mode === 'batch' ? '批量任务价（应用批量折扣）' : '标准价'}；价目表由人工录入，成本按服务端上报 usage 计算`);
  if (plan.judge?.enabled) {
    lines.push(`- 评审模型：${plan.judge.target?.name || '—'}（${plan.judge.target?.model || '—'}）${plan.judge.self_judging ? '；注意：评审目标与被测目标相同，存在自我偏好风险' : ''}`);
  }
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(`- 目标 A 总判定：**${summary.verdicts?.overall?.a?.status || '—'}**（${verdictLabel(summary.verdicts?.overall?.a?.status)}，可判定题 ${summary.verdicts?.overall?.a?.totalGraded ?? 0}）`);
  if (plan.target_b) {
    lines.push(`- 目标 B 总判定：**${summary.verdicts?.overall?.b?.status || '—'}**（${verdictLabel(summary.verdicts?.overall?.b?.status)}，可判定题 ${summary.verdicts?.overall?.b?.totalGraded ?? 0}）`);
    lines.push(`- A/B 比较：**${summary.comparison?.status || '—'}**（${verdictLabel(summary.comparison?.status)}；置信区间不重叠才判 DIFFERENT）`);
  }
  const failed = summary.failed_items || [];
  if (failed.length) {
    const byTarget = targetKeys.map((key) => `${key.toUpperCase()} ${failed.filter((item) => item.target === key).length} 题`).join(' / ');
    lines.push(`- 未通过的关键样本：${failed.slice(0, 6).map((item) => `${item.target.toUpperCase()}:${item.item_id}`).join('、')}${failed.length > 6 ? ' 等' : ''}（${byTarget}）`);
  }
  lines.push('');
  lines.push('## 分维度结果');
  lines.push('');
  lines.push(...dimensionRowsMarkdown(summary, targetKeys));
  lines.push('');
  if (summary.billing_audit) {
    const audit = summary.billing_audit;
    lines.push('## 计费审计（A/B 同题）');
    lines.push('');
    lines.push(`- 判定：**${audit.status}**；${audit.reason}`);
    lines.push(`- 样本：题目 ${audit.sample_size} 道，A/B 可用 usage 配对 ${audit.pairs} 对（不足 ${audit.insufficient_usage} 条）；输入比值中位 ${audit.prompt_ratio_median ?? '—'}，输出比值中位 ${audit.completion_ratio_median ?? '—'}`);
    lines.push(`- 缓存命中：A ${audit.cache?.a?.hit_rate ?? '—'}（${audit.cache?.a?.cached_responses ?? 0}/${audit.cache?.a?.responses ?? 0}），B ${audit.cache?.b?.hit_rate ?? '—'}（${audit.cache?.b?.cached_responses ?? 0}/${audit.cache?.b?.responses ?? 0}）${audit.cache?.suspect ? '；命中率差异达到嫌疑门槛' : ''}`);
    if (audit.cost?.available) {
      lines.push(`- 账面成本：实际 A ${audit.cost.currency} ${audit.cost.actual}；同任务按 A 价目表、B usage 计算 ${audit.cost.currency} ${audit.cost.expected_at_a_prices}；比值 ${audit.cost.ratio ?? '—'}（${audit.cost.batch ? '批量价' : '标准价'}）`);
    } else {
      lines.push('- 账面成本：目标 A 未配置价目表，无法复核；请先补充输入/输出/缓存单价与折扣。');
    }
    for (const caveat of audit.caveats || []) lines.push(`- 注意：${caveat}`);
    lines.push('');
  }
  if (summary.routing_audit) {
    const audit = summary.routing_audit;
    lines.push('## 混推理审计');
    lines.push('');
    lines.push(`- 判定：**${audit.status}**；${audit.reason}`);
    lines.push(`- 采样：${audit.sample_size} 道探针，重复 ${audit.repeats} 次，temperature=${audit.temperature}；目标 A 可判样本 ${audit.a?.total_graded ?? 0}`);
    lines.push(`- 目标 A：强题混合 ${audit.a?.strong_mixed ?? 0} 道，对照题通过率 ${audit.a?.control_pass_rate ?? '—'}；返回 model ${(audit.a?.models || []).join('、') || '未返回'}；fingerprint ${(audit.a?.fingerprints || []).join('、') || '未返回'}`);
    if (audit.b) lines.push(`- 目标 B：强题混合 ${audit.b?.strong_mixed ?? 0} 道，对照题通过率 ${audit.b?.control_pass_rate ?? '—'}`);
    for (const caveat of audit.caveats || []) lines.push(`- 注意：${caveat}`);
    lines.push('');
  }
  if (summary.costs) {
    lines.push('## 成本与推理性价比');
    lines.push('');
    lines.push('| 目标 | 币种 | 总账面成本 | 每请求 | 每可判定题 | 每通过题 | 通过题/元 | 说明 |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const key of targetKeys) {
      const cost = summary.costs[key];
      if (!cost) continue;
      if (!cost.available) {
        lines.push(`| ${key.toUpperCase()} | — | — | — | — | — | — | ${cost.reason || '不可计算'} |`);
        continue;
      }
      lines.push(`| ${key.toUpperCase()} | ${cost.currency} | ${cost.total} | ${cost.cost_per_request} | ${cost.cost_per_graded_item ?? '—'} | ${cost.cost_per_passed_item ?? '—'} | ${cost.passed_per_currency ?? '—'} | ${cost.batch ? '批量价' : '标准价'}；${cost.estimated_samples} 条为本地估算 |`);
    }
    lines.push('');
    const snapshot = summary.pricing_snapshot || {};
    for (const key of targetKeys) {
      const price = snapshot[key];
      if (!price?.enabled) { lines.push(`- 目标 ${key.toUpperCase()} 价目表：未配置`); continue; }
      const windows = (price.windows || []).map((window) => `${window.label} ${String(window.start)}–${String(window.end)} ×${window.multiplier}`).join('，') || '无';
      lines.push(`- 目标 ${key.toUpperCase()} 价目表快照：${price.currency} 输入 ${price.input} / 输出 ${price.output} / 缓存命中 ${price.cached_input ?? '按输入价'}（每百万 token），厂商折扣 ${price.vendor_discount_pct}%，批量折扣 ${price.batch_discount_pct}%，时区 ${price.timezone}；时段：${windows}`);
    }
    lines.push('- 成本只按服务端上报 usage × 已录入价目表计算，是账面成本，不是厂商账单；若 usage 虚高，成本也会虚高。');
    lines.push('- 每通过题成本只对本题库与本次参数有效；样本不足时不要用单点比值做采购决策。');
    lines.push('');
  }
  if (summary.failed_items?.length) {
    lines.push('## 未通过样本（最多 20 条）');
    lines.push('');
    for (const item of summary.failed_items.slice(0, 20)) {
      lines.push(`### ${String(item.target || 'a').toUpperCase()} · ${item.item_id}（${DIMENSION_META[item.dimension]?.title || item.dimension}）`);
      lines.push(`- 题目：${item.prompt}`);
      lines.push(`- 回答：${String(item.answer || '').replace(/\n/g, ' ').slice(0, 240)}`);
      lines.push(`- 未通过项：${item.checks.join('、') || '—'}`);
      lines.push('');
    }
  }
  lines.push('## 用量与指纹');
  lines.push('');
  for (const key of targetKeys) {
    const usage = summary.usage?.[key];
    const fingerprint = usage || {};
    lines.push(`- 目标 ${key.toUpperCase()}：请求 ${summary.requests ?? 0}，失败 ${summary.failed_requests ?? 0}；usage 返回 ${fingerprint.usage_reported ?? 0} 条、缺失 ${fingerprint.usage_missing ?? 0} 条；completion 估算比值中位 ${fingerprint.completion_ratio_median ?? '—'}，异常 ${fingerprint.completion_ratio_outliers ?? 0} 条；缓存命中响应 ${fingerprint.cached_responses ?? 0} 条；响应 model 字段 ${(fingerprint.reported_models || []).join('、') || '未返回'}；system_fingerprint ${(fingerprint.system_fingerprints || []).join('、') || '未返回'}。`);
  }
  lines.push('- 无官方 tokenizer：用量比值只能发现「缺失/离谱」，不能用于精确计费对账；缓存命中是服务端行为，不代表质量差异。');
  lines.push('');
  lines.push('## 方法与局限');
  lines.push('');
  lines.push(`- 方案依据：${(plan.references || []).join('；') || '自建可验证抽查题'}。题目为本工作台自建小样本，不复制受版权题库，也不代表官方 benchmark 分数。`);
  lines.push(`- 判定门槛：每个维度至少 ${plan.thresholds?.minGradedPerDimension ?? PLAN_THRESHOLDS.minGradedPerDimension} 道可判定题；总可判定题至少 ${plan.thresholds?.minGradedTotal ?? PLAN_THRESHOLDS.minGradedTotal} 道；单维度通过率 ≥ ${((plan.thresholds?.pass ?? PLAN_THRESHOLDS.pass) * 100).toFixed(0)}% 判 PASS，≥ ${((plan.thresholds?.warn ?? PLAN_THRESHOLDS.warn) * 100).toFixed(0)}% 判 WARN，否则 FAIL；样本不足判 INSUFFICIENT。`);
  lines.push('- 行为证据不等于权重证明：本报告只能说明「在本次题库与参数下是否观察到质量差异」，不能证明模型权重、量化版本、路由或缓存策略相同。');
  lines.push('- 未测量：服务端 tokenizer 精确计数、queue/prefill 拆分、reasoning token 可见性、多轮与缓存命中率、GPU 与调度指标；评审模型自身存在长度/风格偏好。');
  return lines.join('\n').slice(0, REPORT_LIMIT);
}

function planCsv(run, rows) {
  const header = [
    'run_id', 'item_id', 'dimension', 'prompt', 'prompt_chars',
    'a_success', 'a_graded', 'a_pass', 'a_failed_checks', 'a_latency_ms', 'a_prompt_tokens', 'a_completion_tokens', 'a_token_source', 'a_cached_tokens', 'a_judge_score', 'a_cost',
    'b_success', 'b_graded', 'b_pass', 'b_failed_checks', 'b_latency_ms', 'b_prompt_tokens', 'b_completion_tokens', 'b_token_source', 'b_cached_tokens', 'b_judge_score', 'b_cost',
    'pricing_mode',
  ];
  const batch = run.summary?.pricing_mode === 'batch';
  const lines = [header.join(',')];
  for (const row of rows) {
    const side = (key) => {
      const target = row[key];
      const sample = target?.samples?.find((item) => item.success) || target?.samples?.[0];
      const pricing = run.summary?.pricing_snapshot?.[key];
      const cost = sample?.success && pricing
        ? costOfUsage({ prompt_tokens: sample.prompt_tokens, completion_tokens: sample.completion_tokens, cached_tokens: sample.cached_tokens, token_source: sample.token_source }, pricing, { at: run.created_at, batch })
        : null;
      return [
        sample?.success ?? '', target?.graded ?? '', target?.pass ?? '',
        (target?.checks || []).filter((check) => !check.pass).map((check) => check.name).join('|'),
        sample?.latency_ms ?? '', sample?.prompt_tokens ?? '', sample?.completion_tokens ?? '',
        sample?.token_source ?? '', sample?.cached_tokens ?? '', target?.judge?.score ?? '',
        cost?.available ? cost.total.toFixed(6) : '',
      ];
    };
    const values = [run.id, row.item_id, row.dimension, String(row.prompt || '').slice(0, 200), row.approx_prompt_chars, ...side('a'), ...side('b'), run.summary?.pricing_mode || 'standard'];
    lines.push(values.map((value) => csvEscape(value)).join(','));
  }
  return lines.join('\n');
}

export function createApi({ store, manager, parityManager, planManager, verifyOwnership }) {
  async function ensureInitialized() {
    if (!manager._initialized) {
      await manager.initialize();
      manager._initialized = true;
    }
  }

  async function targetsOrThrow() {
    const targets = await store.readTargets();
    if (!targets.length) throw new Error('尚未配置任何检测目标，请先在「目标配置」中添加接口。');
    return targets;
  }

  function findRun(runId) {
    const run = manager.get(runId);
    if (!run) throw new Error(`未找到运行 ${runId}`);
    return run;
  }

  function findParity(runId) {
    const run = parityManager.get(runId);
    if (!run) throw new Error(`未找到一致性校验运行 ${runId}`);
    return run;
  }

  function findPlanRun(runId) {
    const run = planManager.get(runId);
    if (!run) throw new Error(`未找到测试方案运行 ${runId}`);
    return run;
  }

  function activeOtherRun(kind) {
    const perf = manager.list().find((run) => run.status === 'running');
    if (kind !== 'bench' && perf) throw new Error(`压测运行 ${perf.id} 正在进行，请等它结束再开始${kind === 'parity' ? '一致性校验' : '测试方案'}，避免互相干扰。`);
    const parity = parityManager.list().find((run) => run.status === 'running');
    if (kind !== 'parity' && parity) throw new Error(`一致性校验 ${parity.id} 正在进行，请等待结束或先取消。`);
    const planRun = planManager.list().find((run) => run.status === 'running');
    if (kind !== 'plan' && planRun) throw new Error(`测试方案 ${planRun.id} 正在进行，请等待结束或先取消。`);
    return { perf, parity, planRun };
  }

  return {
    async snapshot({ sessionId } = {}) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const targets = await store.readTargets();
      const runs = manager.list().map(summarizeRun);
      const parityRuns = parityManager.list().map(summarizeParity);
      const planRuns = planManager.list().map(summarizePlan);
      return {
        targets: targets.map(maskTarget),
        runs,
        parity_runs: parityRuns,
        plan_runs: planRuns,
        plans: STANDARD_PLANS,
        dimensions: DIMENSION_META,
        active_run_id: runs.find((run) => run.status === 'running')?.id || null,
        active_parity_run_id:
          parityRuns.find((run) => run.status === 'running' || run.status === 'cancelling')?.id || null,
        active_plan_run_id: planRuns.find((run) => run.status === 'running' || run.status === 'cancelling')?.id || null,
        limits: LIMITS,
        defaults: {
          mode: 'closed',
          concurrency: '1,2,4,8',
          number: 30,
          warmup: 2,
          max_tokens: 256,
          stream: true,
        },
        version: '1.3.2',
      };
    },

    /** Human-UI only: route layer enforces the human-review header. */
    async saveTarget(payload) {
      await ensureInitialized();
      const existing = await store.readTargets();
      const previous = payload?.id ? existing.find((target) => target.id === payload.id) : null;
      // The masked snapshot exposes headers as an array of names; an edit round-trip
      // must not overwrite stored header values the panel was never allowed to read.
      const headersAreMasked =
        payload?.headers == null ||
        Array.isArray(payload.headers) ||
        (typeof payload.headers === 'object' && Object.keys(payload.headers).length === 0);
      const keepHeaders = (payload?.headers_keep === true || Array.isArray(payload?.headers)) && headersAreMasked;
      const merged = {
        ...payload,
        ...(keepHeaders && previous ? { headers: previous.headers || {} } : {}),
        api_key:
          payload?.clear_api_key === true
            ? ''
            : payload?.api_key == null || payload?.api_key === ''
              ? previous?.api_key || ''
              : payload.api_key,
      };
      delete merged.headers_keep;
      delete merged.headers_text;
      const target = normalizeTarget({ ...merged, created_at: previous?.created_at });
      const next = previous ? existing.map((item) => (item.id === previous.id ? target : item)) : [...existing, target];
      await store.writeTargets(next);
      return maskTarget(target);
    },

    /** Human-UI only. */
    async deleteTarget(targetId) {
      await ensureInitialized();
      const existing = await store.readTargets();
      const next = existing.filter((target) => target.id !== targetId);
      if (next.length === existing.length) throw new Error('未找到该目标');
      await store.writeTargets(next);
      return { deleted: targetId };
    },

    async testTarget({ targetId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const targets = await targetsOrThrow();
      const target = targetId ? targets.find((item) => item.id === targetId) : targets[0];
      if (!target) throw new Error('未找到该目标');
      const result = await manager.testConnection(target);
      return { ...result, target: maskTarget(target) };
    },

    async startRun({ sessionId, targetId, plan }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      activeOtherRun('bench');
      const targets = await targetsOrThrow();
      const target = targets.find((item) => item.id === targetId) || (targets.length === 1 ? targets[0] : null);
      if (!target) throw new Error('请选择一个检测目标');
      const run = await manager.start(plan, target, { sessionId });
      return { run_id: run.id, status: run.status, plan: run.plan };
    },

    async getRun({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const run = findRun(runId);
      const detail = detailRun(run);
      detail.samples = await readSampleStats(store, runId);
      return detail;
    },

    async listRuns({ sessionId } = {}) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      return { runs: manager.list().map(summarizeRun) };
    },

    async cancelRun({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      findRun(runId);
      return manager.cancel(runId);
    },

    async compare({ runIds }) {
      await ensureInitialized();
      const ids = (Array.isArray(runIds) ? runIds : String(runIds || '').split(','))
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 6);
      if (!ids.length) throw new Error('请选择要对比的运行');
      const runs = ids.map((id) => detailRun(findRun(id)));
      return {
        runs: runs.map((run) => ({
          id: run.id,
          created_at: run.created_at,
          target: run.target,
          plan: run.plan,
          rounds: run.rounds.map((round) => ({
            key: round.key,
            parallel: round.parallel,
            rate: round.rate,
            summary: round.summary,
            percentiles: round.percentiles,
          })),
          analysis: run.analysis,
        })),
      };
    },

    async startParity({ sessionId, plan }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      activeOtherRun('parity');
      const targets = await targetsOrThrow();
      const run = await parityManager.start(plan, targets, { sessionId });
      return { run_id: run.id, status: run.status, plan: run.plan, prompt_count: run.prompt_count, pair_count: run.pair_count };
    },

    async getParity({ runId, sessionId, includeRows = true }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const run = findParity(runId);
      const detail = summarizeParity(run);
      detail.summary = run.summary || null;
      if (includeRows) {
        const rows = await store.readParityRows(runId);
        detail.rows = rows.map((row) => ({
          prompt_id: row.prompt_id,
          repeat: row.repeat,
          order: row.order,
          prompt: String(row.prompt || '').slice(0, 600),
          a: row.a ? { success: row.a.success, text: String(row.a.text || '').slice(0, 1200), latency_ms: row.a.latency_ms, status_code: row.a.status_code, token_source: row.a.token_source, usage: row.a.usage, error: row.a.error } : null,
          b: row.b ? { success: row.b.success, text: String(row.b.text || '').slice(0, 1200), latency_ms: row.b.latency_ms, status_code: row.b.status_code, token_source: row.b.token_source, usage: row.b.usage, error: row.b.error } : null,
          metrics: row.metrics,
          gold_a: row.gold_a ? { passed: row.gold_a.passed } : null,
          gold_b: row.gold_b ? { passed: row.gold_b.passed } : null,
          judge: row.judge ? { verdict: row.judge.verdict, consistent: row.judge.consistent, calls: row.judge.calls, error: row.judge.error || null } : null,
        }));
      }
      return detail;
    },

    async listParityRuns({ sessionId } = {}) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      return { runs: parityManager.list().map(summarizeParity) };
    },

    async cancelParity({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      findParity(runId);
      return parityManager.cancel(runId);
    },

    async parityReport({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      return { run_id: runId, markdown: parityReportMarkdown(findParity(runId)) };
    },

    async exportParity({ runId, format = 'json', sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const run = findParity(runId);
      const rows = await store.readParityRows(runId);
      const base = `llm-api-parity-${run.id.slice(0, 8)}`;
      if (format === 'csv') {
        return { filename: `${base}.csv`, mime: 'text/csv;charset=utf-8', content: `\ufeff${parityCsv(run, rows)}` };
      }
      if (format === 'md') {
        return { filename: `${base}.md`, mime: 'text/markdown;charset=utf-8', content: parityReportMarkdown(run) };
      }
      return {
        filename: `${base}.json`,
        mime: 'application/json;charset=utf-8',
        content: JSON.stringify(
          {
            generator: 'dsh-llm-api-perf-workbench',
            version: '1.3.2',
            exported_at: new Date().toISOString(),
            kind: 'parity',
            run: { ...summarizeParity(run), plan: run.plan, summary: run.summary },
            pairs: rows,
          },
          null,
          2,
        ),
      };
    },


    async startPlan({ sessionId, plan }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      activeOtherRun('plan');
      const targets = await targetsOrThrow();
      const run = await planManager.start(plan, targets, { sessionId });
      return {
        run_id: run.id,
        status: run.status,
        plan: run.plan,
        estimate: run.estimate,
        item_count: run.plan.item_count,
      };
    },

    async getPlan({ runId, sessionId, includeRows = true }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const run = findPlanRun(runId);
      const detail = summarizePlan(run);
      detail.summary = run.summary || null;
      if (includeRows) {
        const rows = await store.readPlanRows(runId);
        detail.rows = rows.map((row) => ({
          item_id: row.item_id,
          dimension: row.dimension,
          prompt: String(row.prompt || '').slice(0, 600),
          approx_prompt_chars: row.approx_prompt_chars,
          samples_per_item: row.samples_per_item,
          a: row.a ? {
            success: row.a.success,
            graded: row.a.graded,
            pass: row.a.pass,
            checks: row.a.checks,
            stability: row.a.stability,
            samples: (row.a.samples || []).map((sample) => ({
              success: sample.success,
              text: String(sample.text || '').slice(0, 800),
              latency_ms: sample.latency_ms,
              token_source: sample.token_source,
              prompt_tokens: sample.prompt_tokens,
              completion_tokens: sample.completion_tokens,
              cached_tokens: sample.cached_tokens,
              error: sample.error,
            })),
            judge: row.a.judge || null,
          } : null,
          b: row.b ? {
            success: row.b.success,
            graded: row.b.graded,
            pass: row.b.pass,
            checks: row.b.checks,
            stability: row.b.stability,
            samples: (row.b.samples || []).map((sample) => ({
              success: sample.success,
              text: String(sample.text || '').slice(0, 800),
              latency_ms: sample.latency_ms,
              token_source: sample.token_source,
              prompt_tokens: sample.prompt_tokens,
              completion_tokens: sample.completion_tokens,
              cached_tokens: sample.cached_tokens,
              error: sample.error,
            })),
            judge: row.b.judge || null,
          } : null,
        }));
      }
      return detail;
    },

    async listPlanRuns({ sessionId } = {}) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      return { runs: planManager.list().map(summarizePlan), plans: STANDARD_PLANS, dimensions: DIMENSION_META };
    },

    async cancelPlan({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      findPlanRun(runId);
      return planManager.cancel(runId);
    },

    async planReport({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      return { run_id: runId, markdown: planReportMarkdown(findPlanRun(runId)) };
    },

    async exportPlan({ runId, format = 'json', sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const run = findPlanRun(runId);
      const rows = await store.readPlanRows(runId);
      const base = `llm-api-plan-${run.id.slice(0, 8)}`;
      if (format === 'csv') {
        return { filename: `${base}.csv`, mime: 'text/csv;charset=utf-8', content: `\ufeff${planCsv(run, rows)}` };
      }
      if (format === 'md') {
        return { filename: `${base}.md`, mime: 'text/markdown;charset=utf-8', content: planReportMarkdown(run) };
      }
      return {
        filename: `${base}.json`,
        mime: 'application/json;charset=utf-8',
        content: JSON.stringify(
          {
            generator: 'dsh-llm-api-perf-workbench',
            version: '1.3.2',
            exported_at: new Date().toISOString(),
            kind: 'plan',
            run: { ...summarizePlan(run), plan: run.plan, summary: run.summary },
            items: rows,
          },
          null,
          2,
        ),
      };
    },

    /** Human-UI only: the route layer enforces the human-review header. */
    async discoverModels({ baseUrl, apiKey, targetId }) {
      await ensureInitialized();
      let base = typeof baseUrl === 'string' ? baseUrl.trim() : '';
      let key = typeof apiKey === 'string' ? apiKey : '';
      if (targetId) {
        const targets = await store.readTargets();
        const target = targets.find((item) => item.id === targetId);
        if (!target) throw new Error('目标不存在');
        if (!base) base = target.base_url;
        if (!key) key = target.api_key;
      }
      if (!base) throw new Error('请先填写 Base URL（或选择已有目标）');
      let url;
      try {
        url = new URL('models', base.endsWith('/') ? base : `${base}/`);
      } catch {
        throw new Error('Base URL 不是合法地址');
      }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只支持 http/https');
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        // Local endpoints are the normal case for this workbench; allow them.
      }
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(url, {
          headers: key ? { authorization: `Bearer ${key}` } : {},
          signal: controller.signal,
        });
      } catch (error) {
        throw new Error(`拉取模型列表失败：${error?.name === 'AbortError' ? '15 秒超时' : error.message}`);
      } finally {
        clearTimeout(timer);
      }
      const latency = Date.now() - started;
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(`端点不支持模型列表或鉴权失败（HTTP ${response.status}）：${message}`);
      }
      const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.models)
            ? payload.models
            : [];
      const models = [...new Set(candidates
        .map((item) => (typeof item === 'string' ? item : item?.id ?? item?.name))
        .filter((item) => typeof item === 'string' && item.trim()))]
        .slice(0, 200);
      return {
        base_url: base,
        models,
        latency_ms: latency,
        hint: models.length ? '' : '接口可访问但没有解析到模型 ID；可手工填写模型名。',
      };
    },

    async exportRun({ runId, format = 'json', sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const run = findRun(runId);
      const base = `llm-api-perf-${run.id.slice(0, 8)}`;
      if (format === 'csv') {
        return { filename: `${base}.csv`, mime: 'text/csv;charset=utf-8', content: `\ufeff${roundsToCsv(run)}` };
      }
      if (format === 'md') {
        return { filename: `${base}.md`, mime: 'text/markdown;charset=utf-8', content: reportMarkdown(run) };
      }
      const detail = detailRun(run);
      detail.samples = await readSampleStats(store, runId);
      return {
        filename: `${base}.json`,
        mime: 'application/json;charset=utf-8',
        content: JSON.stringify(
          { generator: 'dsh-llm-api-perf-workbench', version: '1.3.2', exported_at: new Date().toISOString(), run: detail },
          null,
          2,
        ),
      };
    },

    async report({ runId, sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      return { run_id: runId, markdown: reportMarkdown(findRun(runId)) };
    },

    /** Compact context for the Agent: no keys, no prompt text. */
    async context({ sessionId }) {
      await ensureInitialized();
      if (sessionId) await verifyOwnership(sessionId);
      const targets = await store.readTargets();
      const runs = manager.list().slice(0, 10).map(summarizeRun);
      const parityRuns = parityManager.list().slice(0, 10).map(summarizeParity);
      const planRuns = planManager.list().slice(0, 10).map(summarizePlan);
      const running = runs.find((run) => run.status === 'running');
      const parityRunning = parityRuns.find((run) => run.status === 'running' || run.status === 'cancelling');
      const planRunning = planRuns.find((run) => run.status === 'running' || run.status === 'cancelling');
      return {
        targets: targets.map(maskTarget),
        runs,
        parity_runs: parityRuns,
        plan_runs: planRuns,
        plans: STANDARD_PLANS.map((plan) => ({
          id: plan.id,
          title: plan.title,
          emphasis: plan.emphasis,
          engine: plan.engine,
          dimensions: plan.dimensions,
          requires_b: plan.requires_b,
          judge: plan.judge,
          item_count: plan.item_count,
          est_minutes: plan.est_minutes,
        })),
        dimensions: DIMENSION_META,
        running: running ? { run_id: running.id, progress: running.progress, plan: running.plan } : null,
        parity_running: parityRunning ? { run_id: parityRunning.id, progress: parityRunning.progress } : null,
        plan_running: planRunning ? { run_id: planRunning.id, progress: planRunning.progress } : null,
        limits: {
          ...LIMITS,
          parity: { maxPrompts: PARITY_LIMITS.maxPrompts, maxRepeats: PARITY_LIMITS.maxRepeats, maxJudgeCalls: PARITY_LIMITS.maxJudgeCalls },
          plan: { maxItems: PLAN_LIMITS.maxItems, maxRepeats: PLAN_LIMITS.maxRepeats, maxJudgeCalls: PLAN_LIMITS.maxJudgeCalls, maxContextChars: PLAN_LIMITS.maxContextChars },
        },
        help: '压测/一致性校验/测试方案只能在本地工作台会话内发起；Agent 不能创建或修改目标、不能读取 API Key；测试方案的回答原文只保存在本机，Agent 只能拿到摘要，完整导出需人工点击。',
      };
    },
  };
}

async function readSampleStats(store, runId) {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const content = await readFile(join(store.runsDir, runId, 'samples.ndjson'), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const stats = { count: lines.length, warmup: 0, failed: 0, by_round: {} };
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.is_warmup) stats.warmup += 1;
      if (row.success === false) stats.failed += 1;
      stats.by_round[row.round] = (stats.by_round[row.round] || 0) + 1;
    }
    return stats;
  } catch {
    return { count: 0, warmup: 0, failed: 0, by_round: {} };
  }
}

export { reportMarkdown, roundsToCsv, headlineOf, p99 };