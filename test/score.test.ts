import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgent, tierOf } from '../src/index.ts';
import type { AgentRecord } from '../src/index.ts';

const passed = (acp: number, extra: AgentRecord = {}): AgentRecord => ({ admission_test: 'passed', acp_score: acp, ...extra });

test('A1 table driven tests for every tier boundary', async (t) => {
  const table: Array<[string, AgentRecord, number, string]> = [
    ['just under bronze', passed(24.95), 24.99, 'unproven'],
    ['bronze floor', passed(25), 25, 'bronze'],
    ['just under silver', passed(99.95, { aiax_ready: true }), 49.99, 'bronze'],
    ['silver floor', passed(100, { aiax_ready: true }), 50, 'silver'],
    ['just under gold', passed(74.95, { accepted_deliveries: 5 }), 74.99, 'silver'],
    ['gold floor', passed(75, { accepted_deliveries: 5 }), 75, 'gold'],
    ['full record', { listing_age_days: 400, accepted_deliveries: 9, rejected_deliveries: 0, admission_test: 'passed', aiax_ready: true, acp_score: 100 }, 100, 'gold'],
  ];
  for (const [name, record, score, tier] of table) {
    await t.test(name, () => {
      const r = scoreAgent(record);
      assert.equal(r.score, score);
      assert.equal(r.tier, tier);
      assert.equal(tierOf(score), tier);
    });
  }
});

test('A1 rejected deliveries lower the delivery points by the acceptance rate', () => {
  const clean = scoreAgent({ accepted_deliveries: 5 });
  const mixed = scoreAgent({ accepted_deliveries: 5, rejected_deliveries: 5 });
  assert.equal(clean.score, 40);
  assert.equal(mixed.score, 20);
});

test('A2 an unproven agent is never refused', async (t) => {
  const cases: Array<[string, unknown]> = [
    ['empty record', {}],
    ['null record', null],
    ['undefined record', undefined],
    ['failed admission and no deliveries', { admission_test: 'failed', listing_age_days: 365, aiax_ready: true, acp_score: 100 }],
    ['garbage values', { listing_age_days: -5, accepted_deliveries: Number.NaN, acp_score: 'high' }],
    ['only rejected deliveries', { rejected_deliveries: 7 }],
  ];
  for (const [name, record] of cases) {
    await t.test(name, () => {
      const r = scoreAgent(record as AgentRecord);
      assert.equal(r.tier, 'unproven');
      assert.ok(r.score >= 0 && r.score <= 100);
      assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
      assert.ok(!('refused' in r));
      assert.ok(r.reasons.some((x) => x.includes('not refused')));
    });
  }
  await t.test('even a high outside score does not lift an agent with no evidence', () => {
    const r = scoreAgent({ listing_age_days: 90, aiax_ready: true, acp_score: 100 }, { score: 100, source: 'acp' });
    assert.equal(r.tier, 'unproven');
  });
});

test('A3 the outside score moves the tier by at most one step', async (t) => {
  await t.test('bronze with a perfect outside score reaches silver, not gold', () => {
    const own = scoreAgent(passed(25));
    assert.equal(own.tier, 'bronze');
    const r = scoreAgent(passed(25), { score: 100, source: 'test' });
    assert.equal(r.score, 40);
    assert.equal(r.tier, 'bronze');
    const near = scoreAgent(passed(100, { aiax_ready: true, accepted_deliveries: 1 }), { score: 100 });
    assert.ok(['silver', 'gold'].includes(near.tier));
  });
  await t.test('gold with a zero outside score drops at most to silver', () => {
    const rec = passed(100, { accepted_deliveries: 5, aiax_ready: true, listing_age_days: 90 });
    assert.equal(scoreAgent(rec).tier, 'gold');
    const r = scoreAgent(rec, { score: 0 });
    assert.equal(r.score, 80);
    assert.equal(r.tier, 'gold');
    const rec2 = passed(75, { accepted_deliveries: 5 });
    const r2 = scoreAgent(rec2, { score: 0 });
    assert.equal(r2.score, 60);
    assert.equal(r2.tier, 'silver');
  });
  await t.test('a blended score two tiers away is clamped to one step', () => {
    // own bronze 25, outside 0 gives 20 which is one step down: allowed
    assert.equal(scoreAgent(passed(25), { score: 0 }).tier, 'unproven');
    // own unproven by score but proven by evidence, outside 100 gives 39.99: bronze, one step
    const r = scoreAgent(passed(24.95), { score: 100 });
    assert.equal(r.tier, 'bronze');
  });
  await t.test('a full weight outside score is still clamped to one step', () => {
    const bronze = passed(25);
    const up = scoreAgent(bronze, { score: 100, weight: 1 });
    assert.equal(up.score, 100);
    assert.equal(up.tier, 'silver');
    assert.ok(up.reasons.some((x) => x.includes('one tier step')));
    const gold = passed(100, { accepted_deliveries: 5, aiax_ready: true, listing_age_days: 90 });
    const down = scoreAgent(gold, { score: 0, weight: 1 });
    assert.equal(down.score, 0);
    assert.equal(down.tier, 'silver');
  });
  await t.test('every tier with every outside score stays within one step', () => {
    const order = ['unproven', 'bronze', 'silver', 'gold'];
    for (let acp = 0; acp <= 100; acp += 5) {
      for (const acc of [0, 1, 3, 5]) {
        const rec: AgentRecord = { admission_test: 'passed', acp_score: acp, accepted_deliveries: acc, aiax_ready: acc > 2 };
        const own = order.indexOf(scoreAgent(rec).tier);
        for (let out = 0; out <= 100; out += 10) {
          for (const weight of [0, 0.2, 0.5, 0.8, 1]) {
            const got = order.indexOf(scoreAgent(rec, { score: out, weight }).tier);
            assert.ok(Math.abs(got - own) <= 1, `acp ${acp} acc ${acc} out ${out} weight ${weight}`);
          }
        }
      }
    }
  });
  await t.test('an invalid outside score is ignored', () => {
    const a = scoreAgent(passed(50));
    const b = scoreAgent(passed(50), { score: Number.NaN });
    assert.deepEqual(a, b);
  });
});

test('A4 deterministic and pure', () => {
  const rec: AgentRecord = { listing_age_days: 33, accepted_deliveries: 2, rejected_deliveries: 1, admission_test: 'passed', aiax_ready: true, acp_score: 61 };
  const frozen = Object.freeze({ ...rec });
  const a = scoreAgent(frozen, { score: 70, source: 'acp' });
  const b = scoreAgent(frozen, { score: 70, source: 'acp' });
  assert.deepEqual(a, b);
  for (const reason of a.reasons) {
    assert.ok(!/[\u2013\u2014]/.test(reason), 'no long dash');
    assert.ok(!/[\u0660-\u0669\u06f0-\u06f9]/.test(reason), 'Latin digits only');
  }
});
