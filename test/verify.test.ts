import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyKogFee } from '../src/index.ts';

// Recorded from Solana mainnet on 2026-10-23 with getTransaction, encoding jsonParsed, unmodified.
const load = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const T22 = load('pyusd-transfer.json'); // Token 2022 transferChecked of PYUSD, 304533.611451 to 4CFZ...
const SPL = load('usdc-transfer.json'); // legacy SPL Token transferChecked of USDC, 1.000000 to 666k...
const MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const PAYEE = '4CFZKmFLBpWp8pkAEt7w4RTy4nYhajuH6VHHi76az3sT';
const SENDER = 'DPqsobysNf5iA9w7zrQM8HLzCKZEDMkZsWbiidsAt1xo';
const PAID = '304533611451';
const quote = (o: Record<string, unknown> = {}) => ({ amount: PAID, expiresAt: T22.blockTime + 60, ...o });
const clone = (x: any) => JSON.parse(JSON.stringify(x));

test('right fee: the exact quote is accepted and the signature is recorded', () => {
  const seen = new Set<string>();
  const r = verifyKogFee({ tx: T22, quote: quote({ payee: PAYEE, mint: MINT, issuedAt: T22.blockTime - 30 }), payee: PAYEE, mint: MINT, seen });
  assert.deepEqual(r, { ok: true, reason: 'ok', signature: T22.transaction.signatures[0], received: PAID });
  assert.ok(seen.has(T22.transaction.signatures[0]));
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ amount: '1000000', expiresAt: new Date((T22.blockTime + 5) * 1000).toISOString() }), payee: PAYEE, mint: MINT, seen: new Set() }).ok, true, 'over the quote is fine, ISO expiry works');
});

test('short fee: one base unit under the quote is refused and not recorded', () => {
  const seen = new Set<string>();
  const r = verifyKogFee({ tx: T22, quote: quote({ amount: (BigInt(PAID) + 1n).toString() }), payee: PAYEE, mint: MINT, seen });
  assert.equal(r.reason, 'short_fee');
  assert.equal(r.received, PAID);
  assert.equal(seen.size, 0);
});

test('wrong mint: a transfer of another mint does not pay the fee', () => {
  assert.equal(verifyKogFee({ tx: T22, quote: quote(), payee: PAYEE, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', seen: new Set() }).reason, 'wrong_mint');
  assert.equal(verifyKogFee({ tx: SPL, quote: quote({ amount: '1', expiresAt: SPL.blockTime }), payee: '666kcsqjN6aBfGpZukhqj21y1QNESPU2t7y4ZTHazTf7', mint: MINT, seen: new Set() }).reason, 'wrong_mint');
});

test('wrong program: the right mint moved under the legacy token program is refused', () => {
  const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.equal(verifyKogFee({ tx: SPL, quote: { amount: '1', expiresAt: SPL.blockTime }, payee: '666kcsqjN6aBfGpZukhqj21y1QNESPU2t7y4ZTHazTf7', mint: usdcMint, seen: new Set() }).reason, 'wrong_program');
});

test('wrong payee: the mint moved but not to the payee', () => {
  assert.equal(verifyKogFee({ tx: T22, quote: quote(), payee: SENDER, mint: MINT, seen: new Set() }).reason, 'wrong_payee');
  assert.equal(verifyKogFee({ tx: T22, quote: quote(), payee: '11111111111111111111111111111111', mint: MINT, seen: new Set() }).reason, 'wrong_payee');
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ payee: SENDER }), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'quote_mismatch');
});

test('expired quote: a payment that landed after the expiry is refused, one at the expiry is accepted', () => {
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ expiresAt: T22.blockTime - 1 }), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'quote_expired');
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ expiresAt: T22.blockTime }), payee: PAYEE, mint: MINT, seen: new Set() }).ok, true);
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ issuedAt: T22.blockTime + 1 }), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'paid_before_quote');
});

test('replay: the same signature passes once only, across quotes', () => {
  const seen = new Set<string>();
  assert.equal(verifyKogFee({ tx: T22, quote: quote(), payee: PAYEE, mint: MINT, seen }).ok, true);
  assert.equal(verifyKogFee({ tx: T22, quote: quote(), payee: PAYEE, mint: MINT, seen }).reason, 'replayed');
  assert.equal(verifyKogFee({ tx: clone(T22), quote: quote({ amount: '1' }), payee: PAYEE, mint: MINT, seen }).reason, 'replayed');
});

test('reference binds a payment to one quote', () => {
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ reference: 'RefKey1111111111111111111111111111111111111' }), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'reference_missing');
  assert.equal(verifyKogFee({ tx: T22, quote: quote({ reference: '3MVkAh5wn8JXQE2jeQau3vgG6HmB5g2PHfGAZSSjBtPX' }), payee: PAYEE, mint: MINT, seen: new Set() }).ok, true);
});

test('failed and malformed input never passes and never throws', () => {
  const failed = clone(T22); failed.meta.err = { InstructionError: [0, 'Custom'] };
  assert.equal(verifyKogFee({ tx: failed, quote: quote(), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'tx_failed');
  for (const tx of [null, {}, { meta: {} }, { ...clone(T22), blockTime: null }]) assert.equal(verifyKogFee({ tx, quote: quote(), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'malformed_tx');
  for (const q of [{ amount: '1.5', expiresAt: 1 }, { amount: '0', expiresAt: 1 }, { amount: PAID, expiresAt: 'nope' }, { amount: PAID }]) assert.equal(verifyKogFee({ tx: T22, quote: q as any, payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'malformed_quote');
  const bad = clone(T22); bad.meta.postTokenBalances[0].uiTokenAmount.amount = '1e9';
  assert.equal(verifyKogFee({ tx: bad, quote: quote(), payee: PAYEE, mint: MINT, seen: new Set() }).reason, 'malformed_tx');
});
