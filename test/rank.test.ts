import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankBids } from '../src/index.ts';
import type { Bundle, Bid, Records } from '../src/index.ts';

const bundle: Bundle = { id: 'SEAT6', ceiling_usdc: 50, deadline: '2026-11-04T23:59:00Z', acceptance: ['A1', 'A2', 'A3'] };
const tested = 'A pure TypeScript function with node:test unit tests named A1, A2 and A3, run with tsx, fixtures in test/.';
const untested = 'I will write the rankBids function quickly in TypeScript and hand it over the same day.';

const bids: Bid[] = [
  { bid_id: 'b1', agent_id: 'alpha', price_usdc: 45, delivery_by: '2026-10-30T20:00:00Z', approach_md: tested },
  { bid_id: 'b2', agent_id: 'beta', price_usdc: 5, delivery_by: '2026-10-28T20:00:00Z', approach_md: untested },
  { bid_id: 'b3', agent_id: 'gamma', price_usdc: 30, delivery_by: '2026-10-29T20:00:00Z', approach_md: 'Tests first: A1 and A2 as node:test cases, then the code.' },
  { bid_id: 'b4', agent_id: 'delta', price_usdc: 80, delivery_by: '2026-10-29T20:00:00Z', approach_md: tested },
  { bid_id: 'b5', agent_id: 'eps', price_usdc: 40, delivery_by: '2026-12-01T20:00:00Z', approach_md: tested },
];
const records: Records = {
  alpha: { accepted_deliveries: 2, rejected_deliveries: 0, tier: 'bronze' },
  beta: { accepted_deliveries: 0, tier: 'unproven' },
  gamma: { accepted_deliveries: 5, rejected_deliveries: 1, tier: 'silver' },
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

test('A1 deterministic for the same input', async (t) => {
  await t.test('two runs give the same output', () => {
    assert.deepEqual(rankBids(bundle, bids, records), rankBids(bundle, bids, records));
  });
  await t.test('the order of the bids does not change the result', () => {
    const a = rankBids(bundle, bids, records);
    for (const perm of [[...bids].reverse(), [bids[2], bids[0], bids[4], bids[1], bids[3]]]) {
      assert.deepEqual(rankBids(bundle, perm, records), a);
    }
  });
  await t.test('inputs are not changed', () => {
    const frozen = Object.freeze(bids.map((b) => Object.freeze({ ...b })));
    assert.doesNotThrow(() => rankBids(Object.freeze({ ...bundle }), frozen as Bid[], records));
  });
  await t.test('ties break on lower price, then on bid_id', () => {
    const same: Bid[] = [
      { bid_id: 'z', agent_id: 'n', price_usdc: 25, approach_md: tested },
      { bid_id: 'a', agent_id: 'n', price_usdc: 25, approach_md: tested },
    ];
    const r = rankBids(bundle, same, {});
    assert.deepEqual(r.map((x) => x.bid_id), ['a', 'z']);
    assert.deepEqual(r.map((x) => x.rank), [1, 2]);
  });
  await t.test('an equal score breaks on the lower price before the bid_id', () => {
    const r = rankBids(bundle, [
      { bid_id: 'a', agent_id: 'n', price_usdc: 35, approach_md: 'Tests for A1, A2 and A3.' },
      { bid_id: 'b', agent_id: 'n', price_usdc: 10, approach_md: 'Tests for A1.' },
    ], {});
    assert.equal(r[0].score, r[1].score);
    assert.deepEqual(r.map((x) => x.bid_id), ['b', 'a']);
  });
  await t.test('a valid bid scoring 0 still ranks before an invalid cheaper bid', () => {
    const r = rankBids(bundle, [
      { bid_id: 'late', agent_id: 'n', price_usdc: 10, delivery_by: '2027-01-01T00:00:00Z', approach_md: tested },
      { bid_id: 'zero', agent_id: 'n', price_usdc: 50, delivery_by: '2026-11-01T00:00:00Z', approach_md: 'I will do it.' },
    ], {});
    assert.equal(r[0].score, 0);
    assert.deepEqual(r.map((x) => x.bid_id), ['zero', 'late']);
  });
  await t.test('ranks are 1 to n with no gaps, invalid bids last', () => {
    const r = rankBids(bundle, bids, records);
    assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4, 5]);
    const last2 = r.slice(-2).map((x) => x.bid_id).sort();
    assert.deepEqual(last2, ['b4', 'b5']);
    assert.ok(r.slice(-2).every((x) => x.score === 0));
  });
});

test('A2 every bid gets a reason of at least 10 words', () => {
  const odd: Bid[] = [...bids, { bid_id: 'b6', agent_id: 'x', price_usdc: Number.NaN, approach_md: '' }, { bid_id: 'b7', agent_id: 'x', price_usdc: 0, approach_md: tested }];
  const r = rankBids(bundle, odd, records);
  assert.equal(r.length, odd.length);
  for (const x of r) {
    assert.ok(words(x.reason) >= 10, `${x.bid_id}: ${x.reason}`);
    assert.ok(!/[\u2013\u2014]/.test(x.reason), 'no long dash');
    assert.ok(!/[\u0660-\u0669\u06f0-\u06f9]/.test(x.reason), 'Latin digits only');
  }
  const over = r.find((x) => x.bid_id === 'b4')!;
  assert.match(over.reason, /above the ceiling/);
  const late = r.find((x) => x.bid_id === 'b5')!;
  assert.match(late.reason, /after the bundle deadline/);
});

test('A3 a cheaper bid with no tests never outranks a tested one by price alone', async (t) => {
  await t.test('the near free untested bid ranks below the tested bid at the ceiling', () => {
    const pair: Bid[] = [
      { bid_id: 'cheap', agent_id: 'same', price_usdc: 0.01, approach_md: untested },
      { bid_id: 'tested', agent_id: 'same', price_usdc: 50, approach_md: 'Ships node:test tests.' },
    ];
    for (const tier of ['unproven', 'bronze', 'silver', 'gold'] as const) {
      const r = rankBids({ id: 'x', ceiling_usdc: 50 }, pair, { same: { tier, accepted_deliveries: 3 } });
      assert.equal(r[0].bid_id, 'tested', tier);
    }
  });
  await t.test('holds for every price pair when everything else is equal', () => {
    for (let cheap = 1; cheap <= 50; cheap += 7) {
      for (let dear = cheap; dear <= 50; dear += 7) {
        const r = rankBids({ id: 'x', ceiling_usdc: 50 }, [
          { bid_id: 'u', agent_id: 'k', price_usdc: cheap, approach_md: 'Quick build of the function, handed over soon.' },
          { bid_id: 't', agent_id: 'k', price_usdc: dear, approach_md: 'Quick build of the function with unit tests.' },
        ], { k: { tier: 'bronze', accepted_deliveries: 1 } });
        assert.equal(r[0].bid_id, 't', `${cheap} vs ${dear}`);
      }
    }
  });
  await t.test('saying "no tests" does not count as tests', () => {
    const r = rankBids({ id: 'x', ceiling_usdc: 50 }, [
      { bid_id: 'neg', agent_id: 'k', price_usdc: 1, approach_md: 'Fast delivery, no tests needed for this one.' },
      { bid_id: 'pos', agent_id: 'k', price_usdc: 49, approach_md: 'Delivery with tests.' },
    ], {});
    assert.equal(r[0].bid_id, 'pos');
    assert.match(r[1].reason, /names no tests/);
  });
  await t.test('among tested bids, price still matters', () => {
    const r = rankBids({ id: 'x', ceiling_usdc: 50 }, [
      { bid_id: 'dear', agent_id: 'k', price_usdc: 50, approach_md: 'With tests.' },
      { bid_id: 'cheap', agent_id: 'k', price_usdc: 10, approach_md: 'With tests.' },
    ], {});
    assert.equal(r[0].bid_id, 'cheap');
  });
  await t.test('record and tier can lift a bid, which is not price alone', () => {
    const r = rankBids(bundle, bids.slice(0, 3), records);
    assert.equal(r[0].bid_id, 'b3');
    assert.equal(r[2].bid_id, 'b2');
  });
});
