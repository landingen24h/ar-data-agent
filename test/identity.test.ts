import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  createChallenge, verifyChallenge, challengeMessage, memoryNonceStore,
  DEFAULT_TTL_MS, MAX_TTL_MS, type Challenge,
} from '../src/index.ts';

// keys are generated at run time, so no key is ever stored in this repository
const owner = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const DID = `did:pkh:eip155:8453:${owner.address}`;
const LISTING = 'lax-ext-676dfacaeb79';
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

async function signed(c: Challenge, by = owner) {
  return by.signMessage({ message: challengeMessage(c) });
}

test('A1 valid signature by the listing owner is accepted once', async () => {
  const store = memoryNonceStore();
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  assert.match(c.nonce, /^[0-9a-f]{64}$/);
  assert.equal(Date.parse(c.expiresAt) - Date.parse(c.issuedAt), DEFAULT_TTL_MS);
  const signature = await signed(c);
  const r = await verifyChallenge({ challenge: c, signature, ownerAddress: owner.address.toLowerCase(), now: new Date(T0 + 1000), store });
  assert.deepEqual(r, { ok: true, reason: 'ok' });
  assert.equal(store.size(), 1);
});

test('A2 wrong signer is refused and does not spend the nonce', async () => {
  const store = memoryNonceStore();
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  const r = await verifyChallenge({ challenge: c, signature: await signed(c, other), ownerAddress: owner.address, now: T0, store });
  assert.deepEqual(r, { ok: false, reason: 'wrong_signer' });
  assert.equal(store.size(), 0);
});

test('A3 expired challenge is refused, at and after expiry; early use is refused', async () => {
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0, ttlMs: 60_000 });
  const signature = await signed(c);
  const base = { challenge: c, signature, ownerAddress: owner.address, store: memoryNonceStore() };
  assert.equal((await verifyChallenge({ ...base, now: T0 + 60_000 })).reason, 'expired');
  assert.equal((await verifyChallenge({ ...base, now: T0 + 3_600_000 })).reason, 'expired');
  assert.equal((await verifyChallenge({ ...base, now: T0 - 1 })).reason, 'not_yet_valid');
  assert.equal((await verifyChallenge({ ...base, now: T0 + 59_999 })).reason, 'ok');
});

test('A4 replayed nonce is refused, also with a fresh signature over a new expiry', async () => {
  const store = memoryNonceStore();
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  const signature = await signed(c);
  assert.equal((await verifyChallenge({ challenge: c, signature, ownerAddress: owner.address, now: T0, store })).reason, 'ok');
  assert.deepEqual(await verifyChallenge({ challenge: c, signature, ownerAddress: owner.address, now: T0 + 1, store }), { ok: false, reason: 'replayed_nonce' });
  const again = createChallenge({ did: DID, listingId: LISTING, now: T0 + 10, nonce: c.nonce });
  assert.equal((await verifyChallenge({ challenge: again, signature: await signed(again), ownerAddress: owner.address, now: T0 + 20, store })).reason, 'replayed_nonce');
});

test('A4b the default store also blocks replay', async () => {
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  const signature = await signed(c);
  assert.equal((await verifyChallenge({ challenge: c, signature, ownerAddress: owner.address, now: T0 })).reason, 'ok');
  assert.equal((await verifyChallenge({ challenge: c, signature, ownerAddress: owner.address, now: T0 })).reason, 'replayed_nonce');
});

test('A5 tampered DID, listing, nonce or expiry breaks the signature', async () => {
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  const signature = await signed(c);
  const tampered: Challenge[] = [
    { ...c, did: `did:pkh:eip155:8453:${other.address}` },
    { ...c, listingId: 'lax-ext-000000000000' },
    { ...c, nonce: 'ab'.repeat(32) },
    { ...c, expiresAt: new Date(Date.parse(c.expiresAt) + 1000).toISOString() },
  ];
  for (const t of tampered) {
    const r = await verifyChallenge({ challenge: t, signature, ownerAddress: owner.address, now: T0, store: memoryNonceStore() });
    assert.deepEqual(r, { ok: false, reason: 'wrong_signer' });
  }
});

test('A6 malformed inputs are refused before any signature work', async () => {
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  const signature = await signed(c);
  const v = (challenge: unknown, sig: unknown = signature, own: unknown = owner.address) =>
    verifyChallenge({ challenge: challenge as Challenge, signature: sig as string, ownerAddress: own as string, now: T0, store: memoryNonceStore() });
  const bad: unknown[] = [
    null, 'x', { ...c, did: 'not-a-did' }, { ...c, listingId: 'has space' }, { ...c, nonce: 'XYZ' },
    { ...c, issuedAt: 5 }, { ...c, expiresAt: 'never' }, { ...c, issuedAt: 'nope' },
    { ...c, expiresAt: c.issuedAt }, { ...c, expiresAt: new Date(T0 + MAX_TTL_MS + 1).toISOString() },
  ];
  for (const b of bad) assert.equal((await v(b)).reason, 'malformed_challenge');
  for (const s of [42, 'zz', '0x1234', signature + '00']) assert.equal((await v(c, s)).reason, 'malformed_signature');
  assert.equal((await v(c, '0x' + '00'.repeat(65))).reason, 'malformed_signature');
  for (const o of [7, '0x123', 'hello']) assert.equal((await v(c, signature, o)).reason, 'malformed_owner');
});

test('A7 createChallenge validates its input', () => {
  assert.throws(() => createChallenge({ did: 'x', listingId: LISTING, now: T0 }), TypeError);
  assert.throws(() => createChallenge({ did: 5 as unknown as string, listingId: LISTING, now: T0 }), TypeError);
  assert.throws(() => createChallenge({ did: DID, listingId: '', now: T0 }), TypeError);
  assert.throws(() => createChallenge({ did: DID, listingId: 1 as unknown as string, now: T0 }), TypeError);
  for (const ttlMs of [0, -1, 1.5, MAX_TTL_MS + 1]) assert.throws(() => createChallenge({ did: DID, listingId: LISTING, now: T0, ttlMs }), RangeError);
  assert.throws(() => createChallenge({ did: DID, listingId: LISTING, now: T0, nonce: 'short' }), TypeError);
  assert.throws(() => createChallenge({ did: DID, listingId: LISTING, now: new Date('bad') }), TypeError);
  const a = createChallenge({ did: DID, listingId: LISTING, now: new Date(T0) });
  const b = createChallenge({ did: DID, listingId: LISTING, now: T0 });
  assert.notEqual(a.nonce, b.nonce);
  assert.equal(a.issuedAt, '2026-10-23T12:00:00.000Z');
});

test('A8 the signed text is stable and names every field', () => {
  const c = createChallenge({ did: DID, listingId: LISTING, now: T0, nonce: 'cd'.repeat(32) });
  const m = challengeMessage(c);
  for (const v of [c.did, c.listingId, c.nonce, c.issuedAt, c.expiresAt]) assert.ok(m.includes(v));
  assert.equal(m.split('\n')[0], 'Kognai LAX listing ownership challenge');
});
