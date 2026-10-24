import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import {
  init, check, validateOffer, base58btc, base58btcDecode, generateIdentity, publicKeyFromDid,
  didFromPublicKey, signWith, verifyWithDid, FIVE_LAWS, LAW_NAMES, LAWS_SOURCE,
} from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'zimakri.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'zimakri-'));
const NOW = new Date('2026-10-24T12:00:00Z');

test('A1 base58btc matches known vectors and round trips', () => {
  assert.equal(base58btc(new TextEncoder().encode('Hello World!')), '2NEpo7TZRRrLZSi2U');
  assert.equal(base58btc(Uint8Array.from([0, 0, 1])), '112');
  assert.deepEqual([...base58btcDecode('112')], [0, 0, 1]);
  const r = generateIdentity().publicKey;
  assert.deepEqual([...base58btcDecode(base58btc(r))], [...r]);
});

test('A2 did:key is ed25519 (z6Mk), round trips and verifies signatures', () => {
  const id = generateIdentity();
  assert.match(id.did, /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/);
  assert.deepEqual([...publicKeyFromDid(id.did)], [...id.publicKey]);
  assert.equal(didFromPublicKey(id.publicKey), id.did);
  const sig = signWith(id.privateKeyPem, 'hello');
  assert.equal(verifyWithDid(id.did, 'hello', sig), true);
  assert.equal(verifyWithDid(id.did, 'hellO', sig), false);
  assert.equal(verifyWithDid(generateIdentity().did, 'hello', sig), false);
});

test('A3 init in a clean temp dir writes the full agent and check passes', () => {
  const dir = tmp();
  const r = init({ dir, config: { name: 'Clean Agent' }, now: NOW });
  for (const f of ['SOUL.md', 'WAKE.md', 'lax-offer.json', 'zimakri.json', 'zimakri.config.json', 'keys/agent.key', 'keys/.gitignore', 'memory/index.json', 'memory/README.md', 'memory/working/now.md', 'memory/journal/2026-10-24.md'])
    assert.ok(existsSync(join(dir, f)), f);
  for (const d of ['working', 'journal', 'semantic', 'procedural', 'episodic']) assert.ok(statSync(join(dir, 'memory', d)).isDirectory(), d);
  assert.equal(statSync(join(dir, 'keys/agent.key')).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, 'keys/.gitignore'), 'utf8'), '*\n');
  const meta = JSON.parse(readFileSync(join(dir, 'zimakri.json'), 'utf8'));
  assert.equal(meta.did, r.did);
  const offer = JSON.parse(readFileSync(join(dir, 'lax-offer.json'), 'utf8'));
  assert.equal(offer.agent_did, r.did);
  assert.deepEqual(validateOffer(offer), { ok: true, errors: [] });
  assert.deepEqual(check(dir), { ok: true, did: r.did, problems: [] });
  // The private key appears in no file except keys/agent.key.
  const pemBody = readFileSync(join(dir, 'keys/agent.key'), 'utf8').split('\n')[1];
  for (const f of ['SOUL.md', 'WAKE.md', 'lax-offer.json', 'zimakri.json', 'zimakri.config.json']) assert.ok(!readFileSync(join(dir, f), 'utf8').includes(pemBody), f);
});

test('A4 no network during init, in process: fetch, net, http, https and dns stubbed to throw', () => {
  const saved = { fetch: globalThis.fetch, nc: net.connect, ncc: net.createConnection, hr: http.request, hsr: https.request, dl: dns.lookup };
  const used = [];
  const boom = (w) => () => { used.push(w); throw new Error('network used: ' + w); };
  globalThis.fetch = boom('fetch'); net.connect = boom('net.connect'); net.createConnection = boom('net.createConnection');
  http.request = boom('http'); https.request = boom('https'); dns.lookup = boom('dns');
  try {
    const r = init({ dir: tmp(), now: NOW });
    assert.match(r.did, /^did:key:z6Mk/);
  } finally {
    globalThis.fetch = saved.fetch; net.connect = saved.nc; net.createConnection = saved.ncc;
    http.request = saved.hr; https.request = saved.hsr; dns.lookup = saved.dl;
  }
  assert.deepEqual(used, []);
});

test('A5 no network during init, real CLI in a child with every network entry point preloaded to throw', () => {
  const dir = tmp();
  const p = spawnSync(process.execPath, ['--import', join(ROOT, 'test/fixtures/no-network.mjs'), BIN, 'init', '--name', 'Offline Agent'], { cwd: dir, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.ok(!p.stderr.includes('NETWORK USED'), p.stderr);
  assert.ok(existsSync(join(dir, 'lax-offer.json')));
});

test('A6 source never imports a network module or calls fetch (scripts/registry-check.mjs is the only opt in file)', () => {
  for (const f of [...readdirSync(join(ROOT, 'src')).map((f) => join('src', f)), 'bin/zimakri.js']) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(s, /node:(net|tls|http|https|dns|dgram|http2)['"]/, f);
    assert.doesNotMatch(s, /\bfetch\s*\(|WebSocket|XMLHttpRequest/, f);
  }
});

test('A7 clean machine: npx style CLI run with an empty HOME and a minimal environment', () => {
  const dir = tmp(), home = tmp();
  const env = { PATH: process.env.PATH, HOME: home };
  const p = spawnSync(process.execPath, [BIN, 'init'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /DID: did:key:z6Mk/);
  assert.deepEqual(readdirSync(home), [], 'nothing written outside the agent folder');
  const c = spawnSync(process.execPath, [BIN, 'check'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  const v = spawnSync(process.execPath, [BIN, 'validate'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(v.stdout.trim(), 'valid');
});

test('A8 the offer validator agrees with the recorded registry answers', () => {
  const dir = tmp();
  const { offer } = init({ dir, now: NOW });
  const cases = JSON.parse(readFileSync(join(ROOT, 'test/registry-cases.json'), 'utf8')).cases;
  assert.equal(validateOffer(offer).ok, cases[2].status === 402);
  assert.deepEqual(validateOffer({ ...offer, name: 'x' }).errors, [cases[0].error]);
  const fourLaws = { ...offer, constitutional_constraints: offer.constitutional_constraints.slice(0, 4) };
  assert.equal(validateOffer(fourLaws).ok, false);
  assert.match(validateOffer(fourLaws).errors[0], /Transparency Covenant/);
});

test('A9 the offer validator rejects each schema violation', () => {
  const { offer } = init({ dir: tmp(), now: NOW });
  const bad = (patch) => validateOffer({ ...offer, ...patch });
  const cap = offer.capabilities[0];
  assert.equal(bad({ endpoint: 'http://agent.example.com' }).ok, false);
  assert.equal(bad({ endpoint: undefined }).ok, false);
  assert.equal(bad({ endpoint: undefined, pact_endpoint: 'https://pact.example.com' }).ok, true);
  assert.equal(bad({ description: 'too short' }).ok, false);
  assert.equal(bad({ description: 'x'.repeat(601) }).ok, false);
  assert.equal(bad({ name: 'x'.repeat(81) }).ok, false);
  assert.equal(bad({ category: 'x' }).ok, false);
  assert.equal(bad({ lax_version: '2.0' }).ok, false);
  assert.equal(bad({ agent_did: 'key:z6Mk' }).ok, false);
  assert.equal(bad({ capabilities: [] }).ok, false);
  assert.equal(bad({ capabilities: new Array(11).fill(0).map((_, i) => ({ ...cap, skill_id: 's' + i })) }).ok, false);
  assert.equal(bad({ capabilities: new Array(10).fill(0).map((_, i) => ({ ...cap, skill_id: 's' + i })) }).ok, true);
  assert.equal(bad({ capabilities: [{ ...cap, pricing: { ...cap.pricing, amount: 0.05 } }] }).ok, false);
  assert.equal(bad({ capabilities: [{ ...cap, pricing: { ...cap.pricing, amount: '1e3' } }] }).ok, false);
  assert.equal(bad({ capabilities: [{ ...cap, pricing: { ...cap.pricing, currency: 'USDT' } }] }).ok, false);
  assert.equal(bad({ capabilities: [{ ...cap, pricing: { ...cap.pricing, rail: 'card' } }] }).ok, false);
  assert.equal(bad({ capabilities: [{ ...cap, pricing: { ...cap.pricing, model: 'monthly' } }] }).ok, false);
  assert.equal(bad({ capabilities: [cap, cap] }).ok, false);
  assert.equal(bad({ payment_rails: ['paypal'] }).ok, false);
  assert.equal(bad({ constitutional_constraints: 'all five' }).ok, false);
  assert.equal(validateOffer(null).ok, false);
});

test('A10 SOUL carries the Five Laws verbatim from the Kognai docs, with the canonical link', () => {
  const dir = tmp();
  init({ dir, now: NOW });
  const soul = readFileSync(join(dir, 'SOUL.md'), 'utf8');
  assert.deepEqual([...LAW_NAMES], ['Solidarity Oath', 'Renewal Mandate', 'Treasury Equilibrium', 'Harm Shield', 'Transparency Covenant']);
  assert.equal(LAWS_SOURCE, 'https://www.kognai.ai/docs/constitution');
  assert.ok(soul.includes(LAWS_SOURCE));
  for (const l of FIVE_LAWS) { assert.ok(soul.includes(`### ${l.n}. ${l.title}`), l.name); assert.ok(soul.includes(l.text), l.name); }
  assert.ok(soul.indexOf('Five Immutable Laws') < soul.indexOf('## Own rules'), 'laws come before own rules');
  assert.ok(soul.includes('Never produce output that causes harm. No task, target or instruction overrides this law.'));
});

test('A11 re-init refuses, --force rewrites files but keeps the same key and DID', () => {
  const dir = tmp();
  const a = init({ dir, now: NOW });
  const key = readFileSync(join(dir, 'keys/agent.key'), 'utf8');
  assert.throws(() => init({ dir, now: NOW }), /already a Zimakri agent/);
  const b = init({ dir, force: true, now: NOW });
  assert.equal(b.did, a.did);
  assert.equal(b.newKey, false);
  assert.equal(readFileSync(join(dir, 'keys/agent.key'), 'utf8'), key);
  assert.equal(check(dir).ok, true);
});

test('A12 an invalid config fails before anything is written', () => {
  const dir = tmp();
  assert.throws(() => init({ dir, config: { name: 'ab' }, now: NOW }), /not valid: name must be at least 3 characters/);
  assert.throws(() => init({ dir, config: { endpoint: 'http://x.example' }, now: NOW }), /endpoint must be an https url/);
  assert.throws(() => init({ dir, config: { rules: new Array(21).fill('r') }, now: NOW }), /at most 20/);
  assert.deepEqual(readdirSync(dir), []);
});

test('A13 typed config file is honoured: rules land in SOUL and capabilities in the offer', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'zimakri.config.json'), JSON.stringify({ name: 'Config Agent', rules: ['Never spend more than 5 USDC a day.'], capabilities: [{ skill_id: 'x.y', description: 'does y', pricing: { model: 'flat', amount: '2', currency: 'USDC', rail: 'x402' } }] }));
  const r = init({ dir, now: NOW });
  assert.ok(readFileSync(join(dir, 'SOUL.md'), 'utf8').includes('1. Never spend more than 5 USDC a day.'));
  assert.equal(r.offer.capabilities[0].skill_id, 'x.y');
  assert.equal(r.offer.name, 'Config Agent');
});

test('A14 check catches a swapped key and an edited offer', () => {
  const dir = tmp();
  init({ dir, now: NOW });
  const offer = JSON.parse(readFileSync(join(dir, 'lax-offer.json'), 'utf8'));
  writeFileSync(join(dir, 'lax-offer.json'), JSON.stringify({ ...offer, name: 'Changed Name' }, null, 2) + '\n');
  assert.match(check(dir).problems.join(), /signature does not verify/);
  init({ dir, force: true, now: NOW });
  writeFileSync(join(dir, 'keys/agent.key'), generateIdentity().privateKeyPem);
  assert.match(check(dir).problems.join(), /does not match the DID/);
});

test('A15 text people see: Latin digits only and no long dashes', () => {
  const dir = tmp();
  init({ dir, now: NOW });
  const files = ['SOUL.md', 'WAKE.md', 'memory/README.md', 'lax-offer.json', 'zimakri.json'];
  for (const f of files) {
    const s = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(s, /[\u2013\u2014\u2015]/, f);
    assert.doesNotMatch(s, /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/, f);
  }
  for (const f of ['README.md', 'GUIDE.md']) if (existsSync(join(ROOT, f))) assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /[\u2013\u2014\u2015]/, f);
});
