/**
 * 价目表与成本核算。
 *
 * 设计原则：
 * - 价格只由人工在「目标配置」里录入，Agent 只读；不联网抓价、不推测厂商现价。
 * - 单价统一为「每 1,000,000 token」，避免每千/每百万混用。
 * - 成本只对「服务端上报 usage」计算；本地估算只作为参考并明确标注。
 * - 时段倍率、厂商折扣、批量折扣、上下文阶梯全部可复现地记录在报告里。
 */

export const PRICING_LIMITS = Object.freeze({
  maxWindows: 6,
  maxPricePerMillion: 100000,
  maxDiscountPct: 100,
});

const CURRENCIES = new Set(['CNY', 'USD']);
const TIME_ZONE_FALLBACK = 'Asia/Shanghai';
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAY_NAMES = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const num = (value, fallback = null) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** 校验原始价目表；返回人类可读的问题列表（空数组表示合法；null/disabled 也合法）。 */
export function pricingIssues(input) {
  if (input == null || input === false) return [];
  if (typeof input !== 'object' || Array.isArray(input)) return ['价目表必须是对象'];
  if (input.enabled === false) return [];
  const issues = [];
  const currency = String(input.currency || 'CNY').toUpperCase();
  if (!CURRENCIES.has(currency)) issues.push('币种只支持 CNY 或 USD');
  for (const key of ['input', 'output']) {
    const n = num(input[key]);
    if (n == null || n <= 0) issues.push(`单价 ${key === 'input' ? '输入' : '输出'} 必须是大于 0 的数字（每百万 token）`);
    else if (n > PRICING_LIMITS.maxPricePerMillion) issues.push('单价超出合理上限（每百万 token）');
  }
  for (const key of ['cached_input', 'cache_write']) {
    const n = num(input[key]);
    if (n != null && (n < 0 || n > PRICING_LIMITS.maxPricePerMillion)) issues.push(`${key} 价格必须在 0 到上限之间`);
  }
  for (const key of ['vendor_discount_pct', 'batch_discount_pct']) {
    const n = num(input[key], 0);
    if (n == null || n < 0 || n > PRICING_LIMITS.maxDiscountPct) issues.push('折扣百分比必须在 0–100 之间');
  }
  const zone = String(input.timezone || TIME_ZONE_FALLBACK);
  if (!validTimeZone(zone)) issues.push(`时区无效：${zone}`);
  if (input.windows != null && !Array.isArray(input.windows)) issues.push('时段规则必须是数组');
  if (Array.isArray(input.windows)) {
    if (input.windows.length > PRICING_LIMITS.maxWindows) issues.push(`时段规则最多 ${PRICING_LIMITS.maxWindows} 条`);
    input.windows.forEach((window, index) => {
      if (!window || typeof window !== 'object') { issues.push(`第 ${index + 1} 条时段规则无效`); return; }
      if (!TIME_RE.test(String(window.start || ''))) issues.push(`第 ${index + 1} 条时段开始时间必须是 HH:MM`);
      if (!TIME_RE.test(String(window.end || ''))) issues.push(`第 ${index + 1} 条时段结束时间必须是 HH:MM`);
      if (String(window.start || '') === String(window.end || '')) issues.push(`第 ${index + 1} 条时段起止时间不能相同（用 00:00–00:00 表示全天也不推荐）`);
      const days = window.weekdays;
      if (days != null && (!Array.isArray(days) || !days.length || days.some((day) => !Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 7))) {
        issues.push(`第 ${index + 1} 条时段星期必须是 1–7 的数组`);
      }
      const multiplier = num(window.multiplier, 1);
      if (multiplier == null || multiplier <= 0 || multiplier > 10) issues.push(`第 ${index + 1} 条时段倍率必须在 0–10 之间`);
    });
  }
  return issues;
}

/** 规范化价目表；非法时抛出带具体原因的 Error，配置页直接显示。 */
export function normalizePricing(input) {
  if (input == null || input === false || input.enabled === false) return null;
  const issues = pricingIssues(input);
  if (issues.length) throw new Error(`价目表配置无效：${issues[0]}`);
  return {
    enabled: true,
    currency: String(input.currency || 'CNY').toUpperCase(),
    input: num(input.input, 0),
    output: num(input.output, 0),
    cached_input: num(input.cached_input),
    cache_write: num(input.cache_write),
    vendor_discount_pct: num(input.vendor_discount_pct, 0),
    batch_discount_pct: num(input.batch_discount_pct, 0),
    timezone: String(input.timezone || TIME_ZONE_FALLBACK),
    windows: (Array.isArray(input.windows) ? input.windows : []).map((window, index) => ({
      label: String(window.label || `时段 ${index + 1}`).slice(0, 40),
      weekdays: Array.isArray(window.weekdays) && window.weekdays.length
        ? [...new Set(window.weekdays.map(Number))].sort((a, b) => a - b)
        : [1, 2, 3, 4, 5, 6, 7],
      start: String(window.start),
      end: String(window.end),
      multiplier: num(window.multiplier, 1),
    })),
  };
}

/** 某个时刻在目标时区是否落入时段窗口；重叠窗口倍率相乘。 */
export function effectiveRate(pricing, at = new Date()) {
  const multiplier = 1;
  if (!pricing?.enabled) return { multiplier, windows: [], timezone: pricing?.timezone || TIME_ZONE_FALLBACK };
  const timezone = pricing.timezone || TIME_ZONE_FALLBACK;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at);
  } catch {
    return { multiplier, windows: [], timezone, error: `时区无效：${timezone}` };
  }
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const weekday = WEEKDAY_NAMES[get('weekday')] || 1;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const nowMinutes = hour * 60 + minute;
  const toMinutes = (text) => {
    const [h, m] = String(text).split(':').map(Number);
    return h * 60 + m;
  };
  const windows = [];
  let applied = 1;
  for (const window of pricing.windows || []) {
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    const inTime = start <= end ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end;
    const inDay = (window.weekdays || [1, 2, 3, 4, 5, 6, 7]).includes(weekday);
    if (inTime && inDay) {
      windows.push({ label: window.label, multiplier: window.multiplier });
      applied *= window.multiplier;
    }
  }
  return { multiplier: Math.round(applied * 10000) / 10000, windows, weekday, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timezone };
}

/**
 * 单条 usage 的账面成本。
 * 返回 {available, total, currency, breakdown, multiplier, windows, discount_factor, batch, estimated, reason}
 */
export function costOfUsage(usage, pricing, options = {}) {
  if (!pricing?.enabled) return { available: false, reason: '目标未配置价目表' };
  const prompt = Number(usage?.prompt_tokens);
  const completion = Number(usage?.completion_tokens);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) {
    return { available: false, reason: '服务端未返回可用 usage，无法计算成本' };
  }
  const cachedRaw = Number(usage?.cached_tokens);
  const cached = Number.isFinite(cachedRaw) && cachedRaw > 0 ? Math.min(cachedRaw, prompt) : 0;
  const uncached = prompt - cached;
  const cachedPrice = pricing.cached_input == null ? pricing.input : pricing.cached_input;
  const inputCost = (uncached / 1e6) * pricing.input;
  const cachedCost = (cached / 1e6) * cachedPrice;
  const outputCost = (completion / 1e6) * pricing.output;
  const subtotal = inputCost + cachedCost + outputCost;
  const rate = effectiveRate(pricing, options.at ? new Date(options.at) : new Date());
  const vendorFactor = 1 - (pricing.vendor_discount_pct || 0) / 100;
  const batchFactor = options.batch ? 1 - (pricing.batch_discount_pct || 0) / 100 : 1;
  const total = subtotal * rate.multiplier * vendorFactor * batchFactor;
  return {
    available: true,
    total,
    currency: pricing.currency,
    unit: 'per_1m_tokens',
    estimated: usage?.token_source === 'estimate',
    breakdown: {
      prompt_tokens: prompt,
      cached_tokens: cached,
      completion_tokens: completion,
      input_cost: inputCost,
      cached_cost: cachedCost,
      output_cost: outputCost,
      subtotal,
    },
    multiplier: rate.multiplier,
    windows: rate.windows,
    discount_factor: Math.round(vendorFactor * batchFactor * 10000) / 10000,
    vendor_discount_pct: pricing.vendor_discount_pct || 0,
    batch_discount_pct: options.batch ? pricing.batch_discount_pct || 0 : 0,
    batch: Boolean(options.batch),
    at: options.at || new Date().toISOString(),
    timezone: pricing.timezone,
  };
}

export function sumUsage(samples = []) {
  const total = { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, responses: 0, usage_missing: 0, estimated: 0 };
  for (const sample of samples) {
    if (!sample?.success) continue;
    const prompt = Number(sample.prompt_tokens);
    const completion = Number(sample.completion_tokens);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion)) { total.usage_missing += 1; continue; }
    total.responses += 1;
    total.prompt_tokens += prompt;
    total.completion_tokens += completion;
    if (sample.token_source === 'estimate') total.estimated += 1;
    const cached = Number(sample.cached_tokens);
    if (Number.isFinite(cached) && cached > 0) total.cached_tokens += Math.min(cached, prompt);
  }
  return total;
}

/** 汇总一组成功样本的成本；按样本时间（缺省用 now）逐条应用时段。 */
export function costOfSamples(samples = [], pricing, options = {}) {
  if (!pricing?.enabled) return { available: false, reason: '目标未配置价目表' };
  let total = 0;
  let counted = 0;
  let estimated = 0;
  const breakdown = { input_cost: 0, cached_cost: 0, output_cost: 0, subtotal: 0 };
  const windows = new Map();
  for (const sample of samples) {
    if (!sample?.success) continue;
    const cost = costOfUsage(
      { prompt_tokens: sample.prompt_tokens, completion_tokens: sample.completion_tokens, cached_tokens: sample.cached_tokens, token_source: sample.token_source },
      pricing,
      { at: options.at || new Date(), batch: options.batch },
    );
    if (!cost.available) continue;
    counted += 1;
    if (cost.estimated) estimated += 1;
    total += cost.total;
    for (const key of Object.keys(breakdown)) breakdown[key] += cost.breakdown[key];
    const label = (cost.windows || []).map((window) => `${window.label}×${window.multiplier}`).join('+') || '标准价';
    windows.set(label, (windows.get(label) || 0) + 1);
  }
  if (!counted) return { available: false, reason: '没有可计费的成功样本（usage 缺失）' };
  return {
    available: true,
    total,
    currency: pricing.currency,
    currency_per: 'per_1m_tokens',
    responses: counted,
    estimated_samples: estimated,
    breakdown,
    windows: [...windows.entries()].map(([label, count]) => ({ label, count })),
    batch: Boolean(options.batch),
    pricing,
  };
}
