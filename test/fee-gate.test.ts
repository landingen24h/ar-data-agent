import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, offerReq, bidReq, SIG, SPL_SIG, PAID, JOB, FEE_HEADER } from './harness.ts';

// Acceptance of the seat: refused without a fee (A1), with a short fee (A2), with a reused fee (A3);
// accepted with a valid fee (A4). Every case runs on both gated routes. No network: transactions are recorded fixtures.
const routes = {
  'POST /offers': { req: (sig?: string, n = 'o1') => offerReq(n, sig), count: (s: any) => s.offers.size, kind: 'offer' },
  'POST /jobs/<id>/bids': { req: (sig?: string) => bidReq(sig), count: (s: any) => s.jobs.get(JOB).bids.length, kind: 'bid' },
} as const;
const short = (BigInt(PAID) + 1n).toString();

for (const [name, r] of Object.entries(routes)) {
  describe(name, () => {
    test('A1 refused without a fee: no header, empty header, garbage, unknown signature', async () => {
      const { store, handle } = setup();
      const none = await handle(r.req());
      assert.equal(none.status, 402);
      assert.equal(none.body.error, 'fee_required');
      assert.equal(none.body.quote.amount, PAID, 'the 402 tells the caller what to pay');
      for (const bad of ['', '   ', 'not-a-signature', '1'.repeat(88)]) {
        const res = await handle(r.req(bad));
        assert.equal(res.status, 402, `proof ${JSON.stringify(bad)}`);
      }
      assert.equal(r.count(store), 0, 'nothing was written');
      assert.equal(store.usedFees.size, 0, 'no fee was spent');
    });

    test('A2 refused with a short fee: one base unit under the quote', async () => {
      const { store, handle } = setup({ fee: { [r.kind]: short } });
      const res = await handle(r.req(SIG));
      assert.equal(res.status, 402);
      assert.equal(res.body.reason, 'short_fee');
      assert.equal(r.count(store), 0);
      assert.equal(store.usedFees.size, 0, 'a refused fee is not burned');
    });

    test('A2 refused with a fee that does not pay the KOG mint, failed or expired', async () => {
      const wrongMint = await setup().handle(r.req(SPL_SIG));
      assert.equal(wrongMint.status, 402);
      const { T22 } = await import('./harness.ts');
      const failed = structuredClone(T22); failed.meta.err = { InstructionError: [0, 'Custom'] };
      assert.equal((await setup({ txs: [failed] }).handle(r.req(SIG))).body.reason, 'tx_failed');
      const late = structuredClone(T22); late.blockTime += 3600;
      assert.equal((await setup({ txs: [late] }).handle(r.req(SIG))).body.reason, 'quote_expired');
    });

    test('A3 refused with a reused fee: same route, the other route, and two requests at once', async () => {
      const s = setup();
      assert.equal((await s.handle(r.req(SIG, 'o1'))).status, 201);
      const again = await s.handle(r.req(SIG, 'o2'));
      assert.equal(again.status, 402);
      assert.equal(again.body.reason, 'replayed');
      const other = r.kind === 'offer' ? bidReq(SIG) : offerReq('o9', SIG);
      assert.equal((await s.handle(other)).status, 402, 'one fee pays for one write across routes');
      assert.equal(r.count(s.store), 1);

      const c = setup();
      const both = await Promise.all([c.handle(r.req(SIG, 'o1')), c.handle(r.req(SIG, 'o2'))]);
      assert.deepEqual(both.map((x) => x.status).sort(), [201, 402], 'only one of two concurrent requests passes');
      assert.equal(r.count(c.store), 1);
    });

    test('A4 accepted with a valid fee, and the fee is recorded as spent', async () => {
      const { store, handle } = setup();
      const res = await handle(r.req(SIG));
      assert.equal(res.status, 201);
      assert.equal(r.count(store), 1);
      assert.ok(store.usedFees.has(SIG));
      const over = setup({ fee: { [r.kind]: '1000000' } });
      assert.equal((await over.handle(r.req(SIG))).status, 201, 'paying more than the quote is fine');
    });
  });
}

test('A4 a request refused for its body never spends the fee', async () => {
  const { store, handle } = setup();
  assert.equal((await handle({ method: 'POST', path: '/offers', headers: { [FEE_HEADER]: SIG }, body: {} })).status, 400);
  assert.equal((await handle(bidReq(SIG, 'no-such-job'))).status, 404);
  assert.equal(store.usedFees.size, 0);
  assert.equal((await handle(offerReq('o1', SIG))).status, 201, 'the same fee still works afterwards');
});
