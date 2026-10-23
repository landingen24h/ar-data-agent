import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAgent, decodeDataUri, ipfsToHttp, readRegistration, describe, httpRpc, httpFetchJson, parseAgentId, summarise } from '../viewer.js';
import { REGISTRIES, DEFAULT_GATEWAY, KOGNAI_TEST_IDENTITY } from '../config.js';

// Real eth_call answers from the public Base and Base Sepolia RPCs, recorded 2026-10-23 at a fixed block.
const REC = JSON.parse(fs.readFileSync(new URL('../fixtures/rpc.json', import.meta.url)));
const SEPOLIA_2 = JSON.parse(fs.readFileSync(new URL('../fixtures/sepolia-2.json', import.meta.url)));
const replay = (net) => async (method, [{ to, data }]) => {
  assert.equal(method, 'eth_call');
  const hit = REC.calls[net][`${to}|${data}`.toLowerCase()];
  if (!hit) throw new Error(`no recording for ${to} ${data.slice(0, 10)}`);
  if (hit.error) throw Object.assign(new Error(hit.error.message), { code: hit.error.code });
  return hit.result;
};
const noFetch = async (url) => { throw new Error(`unexpected fetch ${url}`); };
const files = (map) => async (url) => { if (url in map) return structuredClone(map[url]); throw new Error(`HTTP 404 from ${new URL(url).host}`); };
const load = (net, agentId, extra = {}) => loadAgent({ agentId, network: net, identityRegistry: REGISTRIES[net].identity, reputationRegistry: REGISTRIES[net].reputation, rpc: replay(net), fetchJson: noFetch, ...extra });

test('A1 an existing agent shows its owner, its tokenURI and its registration file', async () => {
  const r = await load('base', '1');
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.owner, '0x89E9E1ab11dD1B138b1dcE6d6A4a0926aaFD5029');
  assert.match(r.tokenURI, /^data:application\/json;base64,/);
  assert.equal(r.registration.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
  const d = describe(r.registration);
  assert.equal(d.name, 'ClawNews');
  assert.equal(d.image, 'https://clawnews.io/logo.png');
  assert.deepEqual(d.endpoints[0], { name: 'web', endpoint: 'https://clawnews.io', version: null });
});

test('A2 ipfs:// and data: tokenURIs are read correctly', async () => {
  const url = DEFAULT_GATEWAY + 'bafkreiffkwgvqplnbg6rev43eizpa3ldybfzb35koecyro67c6ezj5fsba';
  const r = await load('base-sepolia', 2, { fetchJson: files({ [url]: SEPOLIA_2 }) });
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.tokenURI, 'ipfs://bafkreiffkwgvqplnbg6rev43eizpa3ldybfzb35koecyro67c6ezj5fsba');
  const d = describe(r.registration);
  assert.equal(d.name, 'UniMaker Agent');
  assert.deepEqual(d.supportedTrust, ['reputation', 'tee-attestation']);
  assert.equal(d.endpoints[0].name, 'vault');
  assert.equal(ipfsToHttp('ipfs://ipfs/Qm1/a.json', 'https://gw.example/ipfs'), 'https://gw.example/ipfs/Qm1/a.json');
  assert.deepEqual(decodeDataUri('data:application/json,%7B%22name%22%3A%22a%20b%22%7D'), { name: 'a b' });
  assert.deepEqual(decodeDataUri('data:,{"name":"x"}'), { name: 'x' });
  const b64 = 'data:application/json;charset=utf-8;base64,' + Buffer.from('{"name":"Ñandú ✓"}').toString('base64');
  assert.deepEqual(decodeDataUri(b64), { name: 'Ñandú ✓' });
  assert.throws(() => decodeDataUri('data:image/png;base64,AAAA'), /media type/);
  assert.equal(await readRegistration('', noFetch), null);
  await assert.rejects(readRegistration('ar://x', noFetch), /scheme/);
});

test('A3 empty and error states are clear and nothing throws', async () => {
  for (const net of ['base', 'base-sepolia']) {
    const r = await load(net, '99999999');
    assert.equal(r.status, 'empty');
    assert.equal(r.owner, null);
  }
  const zero = await loadAgent({ agentId: 7, network: 'base', rpc: async () => '0x' + '0'.repeat(64), fetchJson: noFetch });
  assert.equal(zero.status, 'empty');
  // real dead https registration file (the host answered error 1033 on 2026-10-23)
  const dead = await load('base', 2, { fetchJson: files({}) });
  assert.equal(dead.status, 'error');
  assert.equal(dead.owner, '0x6F0FaBeBc27a866be65336cB64DEeF9880B5C1AC');
  assert.match(dead.error, /registration file could not be read: HTTP 404/);
  const down = await loadAgent({ agentId: 1, network: 'base', rpc: async () => { throw Object.assign(new Error('fetch failed'), { code: -32000 }); }, fetchJson: noFetch });
  assert.equal(down.status, 'error');
  assert.match(down.error, /RPC call failed: fetch failed/);
  const garbage = await loadAgent({ agentId: 1, network: 'base', rpc: async () => '0xzz', fetchJson: noFetch });
  assert.equal(garbage.status, 'error');
  for (const bad of [undefined, '', '-1', '1.5', 'abc', '1' + '0'.repeat(78)]) assert.equal((await loadAgent({ agentId: bad, network: 'base', rpc: replay('base') })).status, 'error');
  assert.match((await loadAgent({ agentId: 1, network: 'mars', rpc: replay('base') })).error, /Unknown network/);
  assert.match((await loadAgent({ agentId: 1, network: 'base' })).error, /No RPC/);
  assert.equal((await loadAgent()).status, 'error');
  const notObj = await load('base-sepolia', 2, { fetchJson: async () => [1, 2] });
  assert.match(notObj.error, /not a JSON object/);
  const tokenFails = await loadAgent({ agentId: 1, network: 'base', rpc: async (m, [{ data }]) => { if (data.startsWith('0x6352211e')) return replay('base')(m, [{ to: REGISTRIES.base.identity, data }]); throw new Error('boom'); }, fetchJson: noFetch });
  assert.match(tokenFails.error, /tokenURI failed: boom/);
  const repFails = await loadAgent({ agentId: 1, network: 'base', reputationRegistry: '0x0000000000000000000000000000000000000001', rpc: async (m, [{ to, data }]) => (to.startsWith('0x0000') ? Promise.reject(new Error('nope')) : replay('base')(m, [{ to, data }])), fetchJson: noFetch });
  assert.match(repFails.error, /reputation registry failed: nope/);
});

test('A4 reputation entries are read and summarised, and an agent without feedback says so', async () => {
  const r = await load('base', 1);
  assert.equal(r.feedback.count, 46);
  assert.equal(typeof r.feedback.average, 'number');
  const exp = r.feedback.items.reduce((a, x) => a + x.score, 0) / 46;
  assert.equal(r.feedback.average, Math.round(exp * 100) / 100);
  // value 5000 with 4 decimals is a score of 0.5, not 5000
  assert.ok(r.feedback.items.some((x) => x.score === 0.5 && x.tags.includes('custom')));
  assert.ok(r.feedback.items.every((x) => /^0x[0-9a-fA-F]{40}$/.test(x.client) && Array.isArray(x.tags)));
  const s2 = await load('base-sepolia', 2, { fetchJson: async () => SEPOLIA_2 });
  assert.deepEqual(s2.feedback, { count: 1, average: 75, items: [{ client: s2.feedback.items[0].client, index: 1, score: 75, tags: ['credit', 'assessment'] }] });
  const none = await load('base-sepolia', 5);
  assert.equal(none.status, 'ok');
  assert.equal(none.tokenURI, '');
  assert.equal(none.registration, null);
  assert.deepEqual(none.feedback, { count: 0, average: null, items: [] });
  const revoked = summarise([['0xa', '0xb'], [1n, 1n], [10n, 90n], [0, 0], ['', 'q'], ['', ''], [true, false]]);
  assert.deepEqual(revoked, { count: 1, average: 90, items: [{ client: '0xb', index: 1, score: 90, tags: ['q'] }] });
  const noRep = await loadAgent({ agentId: 1, network: 'base', rpc: replay('base'), fetchJson: noFetch });
  assert.equal(noRep.feedback, null);
});

test('A5 works on Base and Base Sepolia', async () => {
  assert.equal(REGISTRIES.base.chainId, 8453);
  assert.equal(REGISTRIES['base-sepolia'].chainId, 84532);
  for (const [net, id] of [['base', 1], ['base-sepolia', 5]]) {
    const r = await loadAgent({ agentId: id, network: net, reputationRegistry: REGISTRIES[net].reputation, rpc: replay(net), fetchJson: noFetch });
    assert.equal(r.status, 'ok', `${net}: ${r.error}`);
  }
});
test('A5 reads the Sepolia test identity Kognai publishes', { todo: KOGNAI_TEST_IDENTITY.agentId === null ? 'Kognai has not published the test identity yet' : false }, async () => {
  const r = await loadAgent({ agentId: KOGNAI_TEST_IDENTITY.agentId, network: 'base-sepolia', reputationRegistry: REGISTRIES['base-sepolia'].reputation, rpc: replay('base-sepolia'), fetchJson: noFetch });
  assert.equal(r.status, 'ok');
});

test('A6 mobile friendly, light and dark', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /color-scheme: light dark/);
  for (const [, px] of html.matchAll(/(?<![-\w])(?:width|min-width):\s*(\d+)px/g)) assert.ok(Number(px) <= 360, `fixed width ${px}px`);
  assert.match(html, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(html, /[\u2013\u2014]/);
});

test('helpers: httpRpc and httpFetchJson', async () => {
  const rpc = httpRpc('https://rpc.example', async (url, init) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: '0x1' }) }));
  assert.equal(await rpc('eth_blockNumber', []), '0x1');
  const rev = httpRpc('https://rpc.example', async () => ({ ok: true, json: async () => ({ error: { code: 3, message: 'execution reverted' } }) }));
  await assert.rejects(rev('eth_call', []), (e) => e.code === 3 && /reverted/.test(e.message));
  const blank = httpRpc('https://rpc.example', async () => ({ ok: true, json: async () => ({ error: {} }) }));
  await assert.rejects(blank('eth_call', []), /JSON-RPC error/);
  const http = httpRpc('https://rpc.example', async () => ({ ok: false, status: 503 }));
  await assert.rejects(http('eth_call', []), /HTTP 503/);
  const fj = httpFetchJson(async () => ({ ok: true, json: async () => ({ a: 1 }) }));
  assert.deepEqual(await fj('https://x.example/a'), { a: 1 });
  await assert.rejects(httpFetchJson(async () => ({ ok: false, status: 404 }))('https://x.example/a'), /HTTP 404 from x.example/);
  assert.equal(parseAgentId(' 42 '), 42n);
  assert.deepEqual(describe(null), { name: null, description: null, image: null, endpoints: [], supportedTrust: [] });
  assert.equal(describe({ endpoints: [{ name: 'a', endpoint: 'b', version: '1' }, null] }).endpoints.length, 1);
});
