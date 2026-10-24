/**
 * 两类「掺水」审计：计费审计、混推理审计。
 *
 * 两者都只做「抽样下的证据判断」，不是司法鉴定：
 * - 计费审计需要目标 B（官方同模型）提供同一提示词的 usage 作为参照；
 *   没有 B 时只能做自洽检查，结论必须是 INSUFFICIENT。
 * - 混推理审计需要足够的重复采样；结论只能是「有嫌疑 / 无证据 / 不确定」。
 */

import { costOfUsage } from './pricing.mjs';
import { planChecks } from './plans.mjs';

const round = (value, digits = 4) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const usage = (sample) => {
  const prompt = Number(sample?.prompt_tokens);
  const completion = Number(sample?.completion_tokens);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
  return { prompt, completion, cached: Number.isFinite(Number(sample?.cached_tokens)) ? Number(sample.cached_tokens) : 0, source: sample?.token_source || 'unknown' };
};
const cacheProbe = (row) => row?.prompt_row?.cache_probe === true;

/** 计费审计：A/B 同题 usage 比值 + 缓存探针 + 账面成本复核。 */
export function billingAudit(rows, options = {}) {
  const included = (rows || []).filter((row) => row.dimension === 'billing');
  const pricingA = options.pricingA || null;
  const pricingB = options.pricingB || null;
  const at = options.at || new Date().toISOString();
  const batch = Boolean(options.batch);
  const pair_rows = [];
  const promptRatios = [];
  const completionRatios = [];
  let insufficientUsage = 0;

  for (const row of included) {
    const aSamples = row.a?.samples || [];
    const bSamples = row.b?.samples || [];
    const count = Math.min(aSamples.length, bSamples.length);
    for (let index = 0; index < count; index += 1) {
      const a = aSamples[index];
      const b = bSamples[index];
      const au = usage(a);
      const bu = usage(b);
      if (!au || !bu) { insufficientUsage += 1; continue; }
      if (au.prompt <= 0 || bu.prompt <= 0) { insufficientUsage += 1; continue; }
      const pair = {
        item_id: row.item_id,
        attempt: index,
        a_prompt: au.prompt, b_prompt: bu.prompt,
        a_completion: au.completion, b_completion: bu.completion,
        a_cached: au.cached, b_cached: bu.cached,
        a_source: au.source, b_source: bu.source,
        prompt_ratio: round(au.prompt / bu.prompt),
        completion_ratio: bu.completion > 0 ? round(au.completion / bu.completion) : null,
      };
      pair_rows.push(pair);
      promptRatios.push(pair.prompt_ratio);
      if (pair.completion_ratio != null) completionRatios.push(pair.completion_ratio);
    }
  }

  const usablePairs = pair_rows.filter((pair) => pair.a_source === 'usage' && pair.b_source === 'usage');
  const promptMedian = median(usablePairs.map((pair) => pair.prompt_ratio));
  const completionMedian = median(usablePairs.map((pair) => pair.completion_ratio).filter(Number.isFinite));
  const promptInflated = usablePairs.filter((pair) => pair.prompt_ratio >= 1.1).length;
  const completionInflated = usablePairs.filter((pair) => (pair.completion_ratio ?? 0) >= 1.1).length;

  // 缓存：重复样本中 cached_tokens>0 的比例；A/B 对比只在两端都愿意上报缓存字段时有意义。
  const cacheSummary = (key) => {
    const samples = included.flatMap((row) => (row[key]?.samples || []).filter((sample) => sample?.success));
    if (!samples.length) return { responses: 0, cached_responses: 0, hit_rate: null, observed: false };
    const cached = samples.filter((sample) => Number.isFinite(Number(sample.cached_tokens)) && Number(sample.cached_tokens) > 0).length;
    const observed = samples.some((sample) => sample.cached_tokens !== null && sample.cached_tokens !== undefined);
    return { responses: samples.length, cached_responses: cached, hit_rate: round(cached / samples.length), observed };
  };
  const cacheA = cacheSummary('a');
  const cacheB = cacheSummary('b');
  const cacheSuspect = Boolean(
    cacheA.observed && cacheB.observed && cacheA.hit_rate != null && cacheB.hit_rate != null
    && cacheA.hit_rate <= 0.2 && cacheB.hit_rate >= 0.5 && cacheB.cached_responses > 0,
  );

  // 账面成本复核：用 B 的 usage × A 的价目表算「同任务应有成本」，与实际 A 成本比较。
  let actualCost = 0;
  let expectedCost = 0;
  let costPairs = 0;
  if (pricingA?.enabled) {
    for (const pair of usablePairs) {
      const aCost = costOfUsage({ prompt_tokens: pair.a_prompt, completion_tokens: pair.a_completion, cached_tokens: pair.a_cached, token_source: pair.a_source }, pricingA, { at, batch });
      const bAtAPrice = costOfUsage({ prompt_tokens: pair.b_prompt, completion_tokens: pair.b_completion, cached_tokens: pair.b_cached, token_source: pair.b_source }, pricingA, { at, batch });
      if (!aCost.available || !bAtAPrice.available) continue;
      actualCost += aCost.total;
      expectedCost += bAtAPrice.total;
      costPairs += 1;
    }
  }
  const costRatio = costPairs >= 4 && expectedCost > 0 ? round(actualCost / expectedCost) : null;

  const minPairs = 6;
  let status = 'INSUFFICIENT';
  let reason = '';
  if (!included.length) {
    reason = '本次运行没有计费探针条目';
  } else if (!usablePairs.length || usablePairs.length < minPairs) {
    reason = `A/B 双方可用 usage 配对不足（${usablePairs.length}/${minPairs}）；无官方参照时不能判断 token 虚高`;
  } else if (pricingA?.enabled && costRatio != null && costRatio >= 1.15) {
    status = 'SUSPECT';
    reason = `同任务账面成本比 A/B = ${costRatio}，高于 1.15；可能是 token 虚高，也可能是 tokenizer/网关注入差异，需人工复核`;
  } else if ((promptMedian ?? 1) >= 1.15 || (completionMedian ?? 1) >= 1.15) {
    status = 'SUSPECT';
    reason = `usage 比值中位数偏高：输入 ${promptMedian ?? '—'}、输出 ${completionMedian ?? '—'}；需排除 tokenizer 与模板差异`;
  } else if (cacheSuspect) {
    status = 'SUSPECT';
    reason = `缓存命中率异常：A ${cacheA.hit_rate} / B ${cacheB.hit_rate}；需确认 A 的缓存字段与计费是否兑现`;
  } else if ((promptMedian ?? 1) >= 1.08 || (completionMedian ?? 1) >= 1.08 || (costRatio != null && costRatio >= 1.08)) {
    status = 'WARN';
    reason = 'usage/成本比值略高，未达到 SUSPECT 门槛，建议扩大样本或核对账单';
  } else if (!pricingA?.enabled) {
    status = 'WARN';
    reason = '使用量比值未见异常，但目标 A 未配置价目表，无法复核账面成本；请补充价格后重跑';
  } else {
    status = 'PASS';
    reason = '本次样本未发现 token 虚高或缓存异常；不代表计费一定准确';
  }

  return {
    kind: 'billing',
    status,
    reason,
    sample_size: included.length,
    pairs: usablePairs.length,
    insufficient_usage: insufficientUsage,
    prompt_ratio_median: promptMedian,
    completion_ratio_median: completionMedian,
    prompt_inflated_pairs: promptInflated,
    completion_inflated_pairs: completionInflated,
    cache: { a: cacheA, b: cacheB, suspect: cacheSuspect },
    cost: {
      available: pricingA?.enabled === true,
      currency: pricingA?.currency || null,
      actual: round(actualCost, 6),
      expected_at_a_prices: round(expectedCost, 6),
      ratio: costRatio,
      pairs: costPairs,
      batch,
      at,
      caveat: 'expected_at_a_prices 使用 B 的上报 usage × A 的价目表计算；假设两端 tokenizer 与请求模板一致',
    },
    top_pairs: pair_rows.slice(0, 8),
    caveats: [
      'token 比值受 tokenizer、system prompt、网关注入与重试影响；比值高不等于主观造假',
      '缓存是 best-effort 且按账号/组织隔离；A/B 必须同账号、同时间窗、同长前缀才有比较意义',
      '账面成本只按服务端上报 usage 计算，无法审计发票、汇率、最低消费与隐藏倍率',
    ],
    method: pricingB?.enabled ? 'A/B 同题 usage 对比 + 缓存探针 + 账面成本复核' : 'A/B 同题 usage 对比 + 缓存探针',
  };
}

/** 逐样本用题目判据判分，用于混推理审计（不能只看“任一重复通过”）。 */
function sampleChecks(row, sample) {
  return planChecks(row?.prompt_row || {}, sample?.text || '');
}

function targetMix(rows, key) {
  const probes = [];
  for (const row of rows) {
    const samples = (row[key]?.samples || []).filter((sample) => sample?.success);
    if (!samples.length) continue;
    const graded = samples.map((sample) => sampleChecks(row, sample)).filter((check) => check.graded);
    const passed = graded.filter((check) => check.pass).length;
    const failed = graded.length - passed;
    const latencies = samples.map((sample) => Number(sample.latency_ms)).filter(Number.isFinite);
    const meanLatency = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null;
    const variance = latencies.length > 1 ? latencies.reduce((sum, value) => sum + (value - meanLatency) ** 2, 0) / (latencies.length - 1) : null;
    const lengths = samples.map((sample) => String(sample.text || '').length);
    probes.push({
      item_id: row.item_id,
      strength: row?.prompt_row?.mix_strength || 'unknown',
      samples: samples.length,
      graded: graded.length,
      passed,
      failed,
      mixed: passed > 0 && failed > 0,
      pass_rate: graded.length ? round(passed / graded.length) : null,
      latency_mean_ms: meanLatency == null ? null : Math.round(meanLatency),
      latency_cv: meanLatency && variance != null ? round(Math.sqrt(variance) / meanLatency, 3) : null,
      output_chars_min: lengths.length ? Math.min(...lengths) : null,
      output_chars_max: lengths.length ? Math.max(...lengths) : null,
      fingerprints: [...new Set(samples.map((sample) => sample.system_fingerprint).filter(Boolean))],
      models: [...new Set(samples.map((sample) => sample.reported_model).filter(Boolean))],
    });
  }
  const strong = probes.filter((probe) => probe.strength === 'strong');
  const control = probes.filter((probe) => probe.strength === 'control');
  const controlGraded = control.reduce((sum, probe) => sum + probe.graded, 0);
  const controlPassed = control.reduce((sum, probe) => sum + probe.passed, 0);
  return {
    probes,
    strong_mixed: strong.filter((probe) => probe.mixed).length,
    control_pass_rate: controlGraded ? round(controlPassed / controlGraded) : null,
    total_graded: probes.reduce((sum, probe) => sum + probe.graded, 0),
    samples: probes.reduce((sum, probe) => sum + probe.samples, 0),
    fingerprints: [...new Set(probes.flatMap((probe) => probe.fingerprints))],
    models: [...new Set(probes.flatMap((probe) => probe.models))],
  };
}

/** 混推理审计：强题/对照题重复采样，检测同一端点的结果混合。 */
export function mixAudit(rows, options = {}) {
  const included = (rows || []).filter((row) => row.dimension === 'routing');
  const temperature = Number(options.temperature ?? 0);
  const repeatCount = Number(options.repeats ?? 0);
  const a = targetMix(included, 'a');
  const b = included.some((row) => row.b) ? targetMix(included, 'b') : null;
  const minSamples = 12;
  let status = 'INSUFFICIENT';
  let reason = '';
  if (!included.length) {
    reason = '本次运行没有混推理探针条目';
  } else if (temperature <= 0) {
    status = 'INCONCLUSIVE';
    reason = 'temperature=0 时同一提示词几乎确定性输出，无法区分“路由混合”和“模型确定性”，请用 temperature≥0.7 重跑';
  } else if (a.total_graded < minSamples || repeatCount < 3) {
    reason = `可判样本不足（${a.total_graded}/${minSamples}，重复 ${repeatCount} 次）；建议至少 3 次重复与 8 道探针`;
  } else if (b && b.strong_mixed >= 2) {
    status = 'INCONCLUSIVE';
    reason = '参考端 B 自身也出现强题混合，不能把 A 的混合归因为偷换模型；可能是采样/服务非确定性';
  } else if (a.strong_mixed >= 2 && (a.control_pass_rate ?? 0) >= 0.9) {
    status = 'SUSPECT';
    reason = `${a.strong_mixed} 道强题在重复中出现“有时过、有时不过”，而对照题通过率 ${a.control_pass_rate}；存在路由混合嫌疑`;
  } else if (a.strong_mixed === 1) {
    status = 'INCONCLUSIVE';
    reason = '仅 1 道强题出现混合，证据不足；建议增加重复次数或探针';
  } else {
    status = 'NO_EVIDENCE';
    reason = '本次样本未观察到强题混合；但不能排除低比例路由或按时间/并发切换';
  }
  return {
    kind: 'routing',
    status,
    reason,
    temperature,
    repeats: repeatCount,
    sample_size: included.length,
    a,
    b,
    caveats: [
      '合法的负载均衡、限流 fallback、灰度与重试会产生同样现象；本审计不能证明具体权重',
      'system_fingerprint / model 字段只是表面证据，可能不变也可能伪造',
      '要证明“偷换模型”需要长期、多时段、足量重复采样与官方对照，单次报告只能给嫌疑',
    ],
  };
}

/** 从 plan 行中汇总每个目标的成本与“每通过一题成本”。 */
export function costSummary(rows, options = {}) {
  const targetKeys = options.targetKeys || ['a'];
  const result = {};
  for (const key of targetKeys) {
    const pricing = key === 'b' ? options.pricingB : options.pricingA;
    const samples = [];
    let passed = 0;
    let graded = 0;
    for (const row of rows || []) {
      for (const sample of row[key]?.samples || []) samples.push(sample);
      if (row[key]?.graded) {
        graded += 1;
        if (row[key].pass) passed += 1;
      }
    }
    if (!pricing?.enabled) {
      result[key] = { available: false, reason: '目标未配置价目表', graded, passed };
      continue;
    }
    let total = 0;
    let responses = 0;
    let estimated = 0;
    for (const sample of samples) {
      if (!sample?.success) continue;
      const cost = costOfUsage(
        { prompt_tokens: sample.prompt_tokens, completion_tokens: sample.completion_tokens, cached_tokens: sample.cached_tokens, token_source: sample.token_source },
        pricing,
        { at: options.at, batch: options.batch },
      );
      if (!cost.available) continue;
      responses += 1;
      if (cost.estimated) estimated += 1;
      total += cost.total;
    }
    if (!responses) {
      result[key] = { available: false, reason: '成功响应没有可计费 usage', graded, passed };
      continue;
    }
    result[key] = {
      available: true,
      currency: pricing.currency,
      total: round(total, 6),
      responses,
      estimated_samples: estimated,
      cost_per_request: round(total / responses, 6),
      cost_per_graded_item: graded ? round(total / graded, 6) : null,
      cost_per_passed_item: passed ? round(total / passed, 6) : null,
      passed_per_currency: total > 0 ? round(passed / total, 4) : null,
      graded,
      passed,
      batch: Boolean(options.batch),
      pricing,
      caveat: '按服务端上报 usage × 已录入价目表计算；不是厂商账单',
    };
  }
  return result;
}
