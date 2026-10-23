import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  runAirlock, ORDER, createChallenge, challengeMessage, memoryNonceStore, handshakeMessage, verifyToken,
  type AirlockContext, type EntryRequest,
} from '../src/index.ts';

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const base = load('base.json');
const cases: any[] = load('cases.json');
const tokens: any[] = load('tokens.json');

// Fixture keys are derived from public strings at run time: test only, never funded.
const owner = privateKeyToAccount(keccak256(toHex('cerberus-e2e fixture owner')));
const stranger = privateKeyToAccount(keccak256(toHex('cerberus-e2e fixture stranger')));
const signer = (who?: string) => (who === 'stranger' ? stranger : owner);
const soulSha = createHash('sha256').update(base.soulText).digest('hex');
const NOW = Date.parse(base.now);

function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = structuredClone(value);
}

async function build(c: any) {
  const did = `did:pkh:eip155:8453:${owner.address}`;
  const challenge = createChallenge({ did, listingId: base.listingId, now: NOW, ttlMs: base.challengeTtlMs, nonce: 'ab'.repeat(32) });
  const w: any = {
    challenge,
    record: structuredClone(base.record),
    outside: base.outside,
    intent: structuredClone(base.intent),
    handshake: { did, soul_sha256: soulSha, laws_accepted: [...base.lawsAccepted], nonce: challenge.nonce, signature: '' },
    job: structuredClone(base.job),
    ctx: { sessionSecret: base.sessionSecret, sessionTtlMs: base.sessionTtlMs },
  };
  for (const [p, v] of Object.entries(c.patch ?? {})) setPath(w, p, v);
  w.identitySignature = await signer(c.identitySigner).signMessage({ message: challengeMessage(w.challenge) });
  w.handshake.signature = await signer(c.soulSigner).signMessage({ message: handshakeMessage(w.handshake) });
  for (const [p, v] of Object.entries(c.postSign ?? {})) setPath(w, p, v);
  const req: EntryRequest = { challenge: w.challenge, identitySignature: w.identitySignature, record: w.record, outside: w.outside, intent: w.intent, handshake: w.handshake };
  const ctx: AirlockContext = {
    now: NOW + (c.nowOffsetMs ?? 0), ownerAddress: owner.address, store: memoryNonceStore(), job: w.job, soulSha256: soulSha,
    minTier: base.minTier, sessionSecret: w.ctx.sessionSecret, sessionTtlMs: w.ctx.sessionTtlMs,
  };
  return { req, ctx };
}

test('fixtures: at least 20 airlock cases and a refusing case for every chamber', () => {
  assert.ok(cases.length + tokens.length >= 20);
  for (const ch of ORDER) assert.ok(cases.some((c) => c.expect.stoppedAt === ch), `no refusing case for ${ch}`);
});

for (const c of cases) {
  test(c.name, async () => {
    const { req, ctx } = await build(c);
    let r = await runAirlock(req, ctx);
    if (c.runTwice) {
      assert.equal(r.ok, true, 'first run must pass');
      r = await runAirlock(req, ctx);
    }
    if (c.expect.ok) {
      assert.equal(r.ok, true, JSON.stringify(r.steps));
      assert.deepEqual(r.steps.map((s) => s.chamber), ORDER);
      assert.equal(typeof r.token, 'string');
      return;
    }
    assert.equal(r.ok, false);
    assert.equal(r.stoppedAt, c.expect.stoppedAt, JSON.stringify(r.steps));
    assert.equal(r.reason, c.expect.reason);
    assert.equal(r.token, undefined);
    // the chambers before the refusal passed, in order, and none after it ran
    const idx = ORDER.indexOf(c.expect.stoppedAt);
    assert.deepEqual(r.steps.map((s) => s.chamber), ORDER.slice(0, idx + 1));
    assert.ok(r.steps.slice(0, idx).every((s) => s.ok));
  });
}

for (const t of tokens) {
  test(t.name, async () => {
    const { req, ctx } = await build({});
    const r = await runAirlock(req, ctx);
    assert.equal(r.ok, true);
    let token = r.token as string;
    if (t.tamper === 'payload') {
      const [p, m] = token.split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      claims.tier = 'gold';
      token = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${m}`;
    }
    if (t.tamper === 'mac') {
      const [p, m] = token.split('.');
      const b = Buffer.from(m, 'base64url');
      b[0] ^= 1;
      token = `${p}.${b.toString('base64url')}`;
    }
    if (t.replace) token = t.replace;
    const v = verifyToken(token, t.secret ?? base.sessionSecret, ctx.now + (t.verifyAtOffsetMs ?? 0));
    assert.equal(v.reason, t.expect);
    assert.equal(v.ok, t.expect === 'ok');
    if (v.ok) {
      assert.equal(v.claims?.job, base.job.id);
      assert.equal(v.claims?.listing, base.listingId);
      assert.equal(v.claims?.tier, 'bronze');
      assert.equal(v.claims?.exp, ctx.now + base.sessionTtlMs);
    }
  });
}

test('chambers are injectable: a stub chamber 3 that refuses stops the airlock there', async () => {
  const { referenceChambers } = await import('../src/index.ts');
  const { req, ctx } = await build({});
  const r = await runAirlock(req, ctx, { ...referenceChambers, intent: () => ({ ok: false, reason: 'window_closed' }) });
  assert.equal(r.stoppedAt, 'intent');
  assert.equal(r.reason, 'window_closed');
});
