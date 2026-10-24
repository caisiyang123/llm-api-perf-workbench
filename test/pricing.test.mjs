import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveRate,
  costOfUsage,
  costOfSamples,
  normalizePricing,
  pricingIssues,
} from '../dsh/engine/pricing.mjs';
import { normalizeTarget, maskTarget } from '../dsh/engine/runner.mjs';

const base = {
  enabled: true,
  currency: 'CNY',
  input: 2,
  output: 8,
  cached_input: 0.5,
  vendor_discount_pct: 10,
  batch_discount_pct: 50,
  timezone: 'Asia/Shanghai',
  windows: [{ label: '闲时', weekdays: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '08:00', multiplier: 0.5 }],
};

test('pricing validation accepts a normal table and rejects bad fields', () => {
  assert.deepEqual(pricingIssues(base), []);
  assert.equal(normalizePricing(base).cached_input, 0.5);
  assert.equal(normalizePricing({ ...base, enabled: false }), null);
  assert.ok(pricingIssues({ ...base, input: 0 }).some((issue) => issue.includes('输入')));
  assert.ok(pricingIssues({ ...base, vendor_discount_pct: 120 }).some((issue) => issue.includes('折扣')));
  assert.ok(pricingIssues({ ...base, timezone: 'Mars/Olympus' }).some((issue) => issue.includes('时区')));
  assert.ok(pricingIssues({ ...base, windows: [{ start: '25:00', end: '08:00', multiplier: 0.5 }] }).length > 0);
  assert.throws(() => normalizePricing({ ...base, output: -1 }), /价目表配置无效/);
});

test('effective rate applies off-peak windows in the configured timezone', () => {
  const night = effectiveRate(base, new Date('2026-10-21T16:30:00Z')); // 00:30 Asia/Shanghai
  assert.equal(night.multiplier, 0.5);
  assert.equal(night.windows[0].label, '闲时');
  const noon = effectiveRate(base, new Date('2026-10-22T04:00:00Z')); // 12:00 Asia/Shanghai
  assert.equal(noon.multiplier, 1);
  const weekend = effectiveRate({ ...base, windows: [{ label: '周末', weekdays: [6, 7], start: '00:00', end: '23:59', multiplier: 0.8 }] }, new Date('2026-10-24T04:00:00Z'));
  assert.equal(weekend.multiplier, 0.8);
});

test('cost math covers input/output/cache, discount, off-peak and batch pricing', () => {
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 500_000, cached_tokens: 200_000, token_source: 'usage' };
  const day = costOfUsage(usage, base, { at: new Date('2026-10-22T04:00:00Z') });
  assert.equal(day.available, true);
  assert.ok(Math.abs(day.breakdown.input_cost - 1.6) < 1e-9); // 800k * 2 / 1M
  assert.ok(Math.abs(day.breakdown.cached_cost - 0.1) < 1e-9); // 200k * 0.5 / 1M
  assert.ok(Math.abs(day.breakdown.output_cost - 4) < 1e-9); // 500k * 8 / 1M
  assert.ok(Math.abs(day.total - (1.6 + 0.1 + 4) * 0.9) < 1e-9);

  const night = costOfUsage(usage, base, { at: new Date('2026-10-21T16:30:00Z') });
  assert.ok(Math.abs(night.total - day.total * 0.5) < 1e-9);

  const batch = costOfUsage(usage, base, { at: new Date('2026-10-22T04:00:00Z'), batch: true });
  assert.ok(Math.abs(batch.total - day.total * 0.5) < 1e-9);
  assert.equal(batch.batch, true);
  assert.equal(batch.batch_discount_pct, 50);

  const missing = costOfUsage({}, base);
  assert.equal(missing.available, false);
  assert.equal(costOfUsage({ prompt_tokens: 10, completion_tokens: 2 }, null).available, false);
  const estimated = costOfUsage({ prompt_tokens: 100, completion_tokens: 20, token_source: 'estimate' }, base);
  assert.equal(estimated.estimated, true);
});

test('costOfSamples aggregates only successful billable responses', () => {
  const samples = [
    { success: true, prompt_tokens: 1_000_000, completion_tokens: 0, cached_tokens: 0, token_source: 'usage' },
    { success: true, prompt_tokens: 0, completion_tokens: 1_000_000, cached_tokens: 0, token_source: 'usage' },
    { success: false, prompt_tokens: 999, completion_tokens: 999 },
    { success: true },
  ];
  const summary = costOfSamples(samples, base, { at: new Date('2026-10-22T04:00:00Z') });
  assert.equal(summary.available, true);
  assert.equal(summary.responses, 2);
  assert.ok(Math.abs(summary.total - (2 + 8) * 0.9) < 1e-9);
  assert.equal(costOfSamples([], base).available, false);
});

test('target normalization stores pricing but masks the API key', () => {
  const target = normalizeTarget({
    name: '供应商 A', base_url: 'https://api.example.com/v1', model: 'demo', pricing: base,
  });
  assert.equal(target.pricing.enabled, true);
  assert.equal(target.pricing.windows[0].label, '闲时');
  const masked = maskTarget({ ...target, api_key: 'sk-secret-1234' });
  assert.equal(masked.has_api_key, true);
  assert.equal(masked.pricing.currency, 'CNY');
  assert.equal(masked.api_key, undefined);
  assert.ok(!JSON.stringify(masked).includes('sk-secret'));
  assert.throws(() => normalizeTarget({ name: 'x', base_url: 'https://x', model: 'm', pricing: { ...base, input: -1 } }), /价目表配置无效/);
});
