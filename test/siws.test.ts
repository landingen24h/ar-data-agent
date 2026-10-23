import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { createMessage, parseMessage, verify, isAddress } from '../src/index.ts';

// keys are generated at run time, none is stored
function wallet() {
  const sk = ed25519.utils.randomPrivateKey();
  const address = base58.encode(ed25519.getPublicKey(sk));
  const sign = (m: string) => base58.encode(ed25519.sign(new TextEncoder().encode(m), sk));
  return { address, sign };
}
const T0 = new Date('2026-10-24T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const DOMAIN = 'app.kognai.ai';

function setup(over: Record<string, unknown> = {}) {
  const w = wallet();
  const message = createMessage({ domain: DOMAIN, address: w.address, nonce: 'abcDEF12345678', issuedAt: T0, statement: 'Sign in to Kognai.', uri: 'https://app.kognai.ai', chainId: 'mainnet', ...over });
  return { w, message, signature: w.sign(message), allowlist: [w.address], seen: new Set<string>() };
}

test('A1 valid signature from an allowlisted wallet signs in and spends the nonce', () => {
  const s = setup();
  const r = verify({ message: s.message, signature: s.signature, address: s.w.address, allowlist: s.allowlist, domain: DOMAIN, now: at(1000), seen: s.seen });
  assert.deepEqual([r.ok, r.reason], [true, 'ok']);
  assert.equal(r.fields?.nonce, 'abcDEF12345678');
  assert.ok(s.seen.has('abcDEF12345678'));
  // signature as raw bytes works too
  const raw = verify({ message: s.message, signature: base58.decode(s.signature), address: s.w.address, allowlist: s.allowlist, domain: DOMAIN, now: at(1000) });
  assert.equal(raw.ok, true);
});

test('A2 wrong domain is refused, also when the signature is valid for that domain', () => {
  const s = setup({ domain: 'evil.example' });
  const r = verify({ message: s.message, signature: s.signature, address: s.w.address, allowlist: s.allowlist, domain: DOMAIN, now: at(1000), seen: s.seen });
  assert.deepEqual([r.ok, r.reason], [false, 'wrong_domain']);
  assert.equal(s.seen.size, 0);
});

test('A3 expired and not yet valid messages are refused', () => {
  const s = setup();
  const base = { message: s.message, signature: s.signature, address: s.w.address, allowlist: s.allowlist, domain: DOMAIN };
  assert.equal(verify({ ...base, now: at(5 * 60 * 1000) }).reason, 'expired');
  assert.equal(verify({ ...base, now: at(10 * 60 * 1000) }).reason, 'expired');
  assert.equal(verify({ ...base, now: at(-2 * 60 * 1000) }).reason, 'not_yet_valid');
  assert.equal(verify({ ...base, now: at(-30 * 1000) }).reason, 'ok'); // inside the 60 s skew
  assert.equal(verify({ ...base, now: at(-30 * 1000), skewMs: 0 }).reason, 'not_yet_valid');
});

test('A4 a replayed nonce is refused, a failed attempt does not spend it', () => {
  const s = setup();
  const base = { message: s.message, address: s.w.address, allowlist: s.allowlist, domain: DOMAIN, now: at(1000), seen: s.seen };
  const forged = wallet().sign(s.message);
  assert.equal(verify({ ...base, signature: forged }).reason, 'bad_signature');
  assert.equal(s.seen.size, 0);
  assert.equal(verify({ ...base, signature: s.signature }).reason, 'ok');
  assert.equal(verify({ ...base, signature: s.signature }).reason, 'replayed_nonce');
  // same nonce in a fresh message with a new expiry is still a replay
  const again = createMessage({ domain: DOMAIN, address: s.w.address, nonce: 'abcDEF12345678', issuedAt: at(500), ttlMs: 60_000 });
  assert.equal(verify({ ...base, message: again, signature: s.w.sign(again) }).reason, 'replayed_nonce');
});

test('A5 an address that is not on the allowlist is refused', () => {
  const s = setup();
  const r = verify({ message: s.message, signature: s.signature, address: s.w.address, allowlist: [wallet().address], domain: DOMAIN, now: at(1000), seen: s.seen });
  assert.deepEqual([r.ok, r.reason], [false, 'not_on_allowlist']);
  assert.equal(verify({ message: s.message, signature: s.signature, address: s.w.address, allowlist: [], now: at(1000) }).reason, 'not_on_allowlist');
  assert.equal(s.seen.size, 0);
});

test('A6 malformed signature, address and message are refused', () => {
  const s = setup();
  const base = { message: s.message, address: s.w.address, allowlist: s.allowlist, domain: DOMAIN, now: at(1000) };
  for (const sig of ['', 'not-base58-0OIl', base58.encode(new Uint8Array(63)), new Uint8Array(65), 42 as unknown as string]) {
    assert.equal(verify({ ...base, signature: sig }).reason, 'malformed_signature');
  }
  assert.equal(verify({ ...base, signature: s.signature, address: 'xyz' }).reason, 'malformed_address');
  const other = wallet().address;
  assert.equal(verify({ ...base, signature: s.signature, address: other, allowlist: [other] }).reason, 'address_mismatch');
  for (const m of ['', 'hello', s.message + '\n', s.message.replace('Version: 1', 'Version: 2'), s.message.replace('Nonce: ', 'Nonce:  '), s.message.replace('2026-10-24T12:05', '2026-13-24T12:05')]) {
    assert.equal(verify({ ...base, message: m, signature: s.signature }).reason, 'malformed_message');
  }
  // a valid signature over a tampered field fails
  const tampered = s.message.replace('Sign in to Kognai.', 'Sign in to Kognai!');
  assert.equal(verify({ ...base, message: tampered, signature: s.signature }).reason, 'bad_signature');
});

test('A7 message format, parse round trip and input checks', () => {
  const w = wallet();
  const m = createMessage({ domain: DOMAIN, address: w.address, nonce: 'Nonce1234', issuedAt: '2026-10-24T12:00:00Z' });
  assert.equal(m, `${DOMAIN} wants you to sign in with your Solana account:\n${w.address}\n\nVersion: 1\nNonce: Nonce1234\nIssued At: 2026-10-24T12:00:00.000Z\nExpiration Time: 2026-10-24T12:05:00.000Z`);
  assert.deepEqual(parseMessage(m), { domain: DOMAIN, address: w.address, nonce: 'Nonce1234', issuedAt: '2026-10-24T12:00:00.000Z', expirationTime: '2026-10-24T12:05:00.000Z' });
  const full = setup();
  assert.equal(parseMessage(full.message)?.statement, 'Sign in to Kognai.');
  assert.equal(parseMessage(full.message)?.chainId, 'mainnet');
  const def = createMessage({ domain: DOMAIN, address: w.address });
  assert.match(parseMessage(def)!.nonce, /^[A-Za-z0-9]{8,64}$/);
  assert.equal(isAddress(w.address), true);
  assert.equal(isAddress(base58.encode(new Uint8Array(31))), false);
  const bad: Array<Record<string, unknown>> = [
    { domain: 'Bad Domain', address: w.address },
    { domain: DOMAIN, address: 'nope' },
    { domain: DOMAIN, address: w.address, nonce: 'short' },
    { domain: DOMAIN, address: w.address, ttlMs: 0 },
    { domain: DOMAIN, address: w.address, ttlMs: 2 * 60 * 60 * 1000 },
    { domain: DOMAIN, address: w.address, issuedAt: 'yesterday' },
    { domain: DOMAIN, address: w.address, issuedAt: T0, expirationTime: at(-1) },
    { domain: DOMAIN, address: w.address, statement: 'two\nlines' },
  ];
  for (const b of bad) assert.throws(() => createMessage(b as never), TypeError);
});
