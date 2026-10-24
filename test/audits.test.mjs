import test from 'node:test';
import assert from 'node:assert/strict';
import { billingAudit, mixAudit, costSummary } from '../dsh/engine/audits.mjs';

const pricing = {
  enabled: true, currency: 'CNY', input: 2, output: 8, cached_input: 0.5,
  vendor_discount_pct: 0, batch_discount_pct: 0, timezone: 'Asia/Shanghai', windows: [],
};

function billingRow(id, { aPrompt = 150, bPrompt = 100, aCompletion = 15, bCompletion = 10, aCached = 0, bCached = 0 } = {}) {
  const sample = (prompt, completion, cached) => ({
    success: true, text: 'ok', prompt_tokens: prompt, completion_tokens: completion,
    cached_tokens: cached, token_source: 'usage', latency_ms: 100,
  });
  return {
    item_id: id, dimension: 'billing', prompt: 'p',
    a: { samples: [sample(aPrompt, aCompletion, aCached), sample(aPrompt, aCompletion, aCached)] },
    b: { samples: [sample(bPrompt, bCompletion, bCached), sample(bPrompt, bCompletion, bCached)] },
  };
}

function routingRow(id, strength, texts) {
  return {
    item_id: id, dimension: 'routing', prompt: 'p',
    prompt_row: { expected_any: [texts.expected], mix_strength: strength },
    a: { samples: texts.answers.map((text) => ({ success: true, text, latency_ms: text === texts.expected ? 90 : 300 })) },
  };
}

test('billing audit flags token inflation against a reference endpoint', () => {
  const rows = Array.from({ length: 6 }, (_, index) => billingRow('b-' + index, { aPrompt: 150, bPrompt: 100, aCompletion: 15, bCompletion: 10 }));
  const audit = billingAudit(rows, { pricingA: pricing, at: '2026-10-22T04:00:00Z' });
  assert.equal(audit.status, 'SUSPECT');
  assert.equal(audit.pairs, 12);
  assert.ok(audit.prompt_ratio_median >= 1.15);
  assert.ok(audit.cost.ratio >= 1.15);
  assert.equal(audit.cost.currency, 'CNY');
});

test('billing audit passes consistent usage and flags cache mismatch', () => {
  const rows = Array.from({ length: 6 }, (_, index) => billingRow('b-' + index, { aPrompt: 100, bPrompt: 100, aCompletion: 10, bCompletion: 10 }));
  const audit = billingAudit(rows, { pricingA: pricing });
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.prompt_ratio_median, 1);
  assert.equal(audit.cost.ratio, 1);

  const cacheRows = rows.map((row, index) => {
    const copy = structuredClone(row);
    copy.b.samples.forEach((sample) => { sample.cached_tokens = index < 4 ? 240 : 0; });
    return copy;
  });
  const cacheAudit = billingAudit(cacheRows, { pricingA: pricing });
  assert.equal(cacheAudit.cache.suspect, true);
  assert.equal(cacheAudit.status, 'SUSPECT');
});

test('billing audit is honest when the reference or usage is missing', () => {
  const rows = [billingRow('b-1')];
  const audit = billingAudit(rows, {});
  assert.equal(audit.status, 'INSUFFICIENT');
  assert.match(audit.reason, /配对不足|无官方参照/);

  const noUsage = rows.map((row) => {
    const copy = structuredClone(row);
    delete copy.b.samples[0].prompt_tokens;
    copy.b.samples[1].prompt_tokens = null;
    return copy;
  });
  assert.equal(billingAudit(noUsage, { pricingA: pricing }).status, 'INSUFFICIENT');
  assert.equal(billingAudit([], {}).status, 'INSUFFICIENT');
});

test('cost summary computes per-passed-item cost from reported usage', () => {
  const rows = [
    { item_id: 'k-1', dimension: 'knowledge', a: { graded: true, pass: true, samples: [{ success: true, prompt_tokens: 1_000_000, completion_tokens: 0, token_source: 'usage' }] } },
    { item_id: 'k-2', dimension: 'knowledge', a: { graded: true, pass: false, samples: [{ success: true, prompt_tokens: 0, completion_tokens: 1_000_000, token_source: 'usage' }] } },
  ];
  const costs = costSummary(rows, { targetKeys: ['a'], pricingA: pricing, at: '2026-10-22T04:00:00Z' });
  assert.equal(costs.a.available, true);
  assert.equal(costs.a.currency, 'CNY');
  assert.ok(Math.abs(costs.a.total - 10) < 1e-9);
  assert.ok(Math.abs(costs.a.cost_per_graded_item - 5) < 1e-9);
  assert.ok(Math.abs(costs.a.cost_per_passed_item - 10) < 1e-9);
  assert.equal(costs.a.passed, 1);
});

test('mix audit detects strong-probe result mixing and temp=0 is inconclusive', () => {
  const strong = [
    routingRow('m-1', 'strong', { expected: '9', answers: ['9', '7', '9'] }),
    routingRow('m-2', 'strong', { expected: '不能', answers: ['不能', '能', '不能'] }),
    routingRow('m-3', 'strong', { expected: '[3, 2, 1]', answers: ['[3, 2, 1]', '[1, 2, 3]', '[3, 2, 1]'] }),
    routingRow('m-4', 'strong', { expected: '3/8', answers: ['3/8', '0.375', '3/8'] }),
  ];
  const control = [
    routingRow('m-5', 'control', { expected: '2', answers: ['2', '2', '2'] }),
    routingRow('m-6', 'control', { expected: '氢', answers: ['氢', '氢', '氢'] }),
    routingRow('m-7', 'control', { expected: 'HELLO', answers: ['HELLO', 'HELLO', 'HELLO'] }),
    routingRow('m-8', 'control', { expected: '12', answers: ['12', '12', '12'] }),
  ];
  const rows = [...strong, ...control];
  const audit = mixAudit(rows, { temperature: 0.7, repeats: 3 });
  assert.equal(audit.status, 'SUSPECT');
  assert.ok(audit.a.strong_mixed >= 2);
  assert.ok(audit.a.control_pass_rate >= 0.9);
  assert.equal(mixAudit(rows, { temperature: 0, repeats: 3 }).status, 'INCONCLUSIVE');
  assert.equal(mixAudit([], { temperature: 0.7, repeats: 3 }).status, 'INSUFFICIENT');
  assert.equal(mixAudit(rows.slice(0, 2), { temperature: 0.7, repeats: 3 }).status, 'INSUFFICIENT');
});

test('mix audit does not blame A when the reference B is also mixed', () => {
  const strong = ['m-1', 'm-2'].map((id, index) => ({
    ...routingRow(id, 'strong', { expected: '9', answers: ['9', '7', '9'] }),
    item_id: id,
  }));
  const rows = strong.map((row, index) => ({
    ...row,
    b: { samples: [{ success: true, text: index === 0 ? '9' : '7' }, { success: true, text: index === 0 ? '7' : '9' }, { success: true, text: '9' }] },
  }));
  assert.equal(mixAudit(rows, { temperature: 0.7, repeats: 3 }).status, 'INSUFFICIENT');
});
