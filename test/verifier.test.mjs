import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeAbiParameters, parseAbiParameters, encodeFunctionResult, decodeFunctionData, parseAbi } from 'viem';
import { decodeCharterData, verifyCharter, getAttestationCall, httpRpc, gatewayIpfs, NETWORKS, EAS_ADDRESS, CHARTER_SCHEMA } from '../verifier.js';

const enc = new TextEncoder();
const texts = { charter: 'Founding Charter of Kognai.\nArticle 1.', constitution: 'Constitution, version 1.', soul: 'SOUL: be honest. ñ é 漢字' };
const cids = { charter: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', constitution: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', soul: 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o' };
const names = ['charter', 'constitution', 'soul'];
const sha = (t) => '0x' + createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
const data = encodeAbiParameters(parseAbiParameters(CHARTER_SCHEMA), ['1.0.0', '2026-10-17', names, names.map((n) => sha(texts[n])), names.map((n) => cids[n])]);
const UID = '0x' + 'ab'.repeat(32);
const ATTESTER = '0x1111111111111111111111111111111111111111';
const ABI = [{ type: 'function', name: 'getAttestation', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [
  { name: 'uid', type: 'bytes32' }, { name: 'schema', type: 'bytes32' }, { name: 'time', type: 'uint64' }, { name: 'expirationTime', type: 'uint64' },
  { name: 'revocationTime', type: 'uint64' }, { name: 'refUID', type: 'bytes32' }, { name: 'recipient', type: 'address' }, { name: 'attester', type: 'address' },
  { name: 'revocable', type: 'bool' }, { name: 'data', type: 'bytes' }] }] }];
const Z = '0x' + '0'.repeat(64), ZA = '0x' + '0'.repeat(40);
const att = (o = {}) => ({ uid: UID, schema: '0x' + 'cd'.repeat(32), time: 1792195200n, expirationTime: 0n, revocationTime: 0n, refUID: Z, recipient: ZA, attester: ATTESTER, revocable: true, data, ...o });
// A fake chain: one map of uid -> attestation per chain id; the rpc is bound to one chain like a real endpoint.
function chain(store, calls = []) {
  return async (method, params) => {
    calls.push({ method, params });
    assert.equal(method, 'eth_call');
    assert.equal(params[0].to.toLowerCase(), EAS_ADDRESS.toLowerCase());
    const { args } = decodeFunctionData({ abi: ABI, data: params[0].data });
    const a = store[args[0].toLowerCase()] ?? att({ uid: Z, schema: Z, time: 0n, attester: ZA, revocable: false, data: '0x' });
    return encodeFunctionResult({ abi: ABI, functionName: 'getAttestation', result: a });
  };
}
const byCid = Object.fromEntries(names.map((n) => [cids[n], texts[n]]));
const ipfsOf = (m = byCid) => async (cid) => { if (!(cid in m)) throw new Error('404'); return enc.encode(m[cid]); };

test('A1 decodeCharterData reads back what the schema encodes', () => {
  const d = decodeCharterData(data);
  assert.deepEqual(d, { version: '1.0.0', date: '2026-10-17', names, digests: names.map((n) => sha(texts[n])), cids: names.map((n) => cids[n]) });
  for (const x of d.digests) assert.match(x, /^0x[0-9a-f]{64}$/);
  const upper = encodeAbiParameters(parseAbiParameters(CHARTER_SCHEMA), ['1', 'd', ['a'], ['0x' + 'AB'.repeat(32)], ['c']]);
  assert.equal(decodeCharterData(upper).digests[0], '0x' + 'ab'.repeat(32));
  assert.throws(() => decodeCharterData('nothex'), /data: expected/);
  const uneven = encodeAbiParameters(parseAbiParameters(CHARTER_SCHEMA), ['1', 'd', ['a', 'b'], ['0x' + 'ab'.repeat(32)], ['c']]);
  assert.throws(() => decodeCharterData(uneven), /same length/);
});

test('A2 a matching attestation shows a match for each text and ok true', async () => {
  const r = await verifyCharter({ uid: UID, network: 'base', rpc: chain({ [UID]: att() }), ipfs: ipfsOf() });
  assert.equal(r.ok, true);
  assert.equal(r.reason, undefined);
  assert.deepEqual(r.attestation, { uid: UID, attester: ATTESTER, time: 1792195200, revoked: false });
  assert.deepEqual(r.texts.map((t) => [t.name, t.cid, t.match, t.actual === t.expected]), names.map((n) => [n, cids[n], true, true]));
});

test('A3 a tampered text shows a mismatch for that text only, with both digests, and ok false', async () => {
  for (const n of names) {
    const m = { ...byCid, [cids[n]]: texts[n] + ' ' };
    const r = await verifyCharter({ uid: UID, network: 'base', rpc: chain({ [UID]: att() }), ipfs: ipfsOf(m) });
    assert.equal(r.ok, false);
    assert.match(r.reason, new RegExp(`^mismatch: ${n}$`));
    for (const t of r.texts) {
      assert.equal(t.match, t.name !== n, t.name);
      assert.equal(t.expected, sha(texts[t.name]));
    }
    const bad = r.texts.find((t) => t.name === n);
    assert.equal(bad.actual, sha(texts[n] + ' '));
    assert.notEqual(bad.actual, bad.expected);
  }
});

test('A4 an unknown UID, a revoked attestation, a failing RPC or an unfetchable text are reported, never thrown', async () => {
  const other = '0x' + '01'.repeat(32);
  let r = await verifyCharter({ uid: other, network: 'base', rpc: chain({ [UID]: att() }), ipfs: ipfsOf() });
  assert.equal(r.ok, false); assert.match(r.reason, /^not_found/); assert.deepEqual(r.texts, []);
  r = await verifyCharter({ uid: UID, network: 'base', rpc: chain({ [UID]: att({ revocationTime: 1792200000n }) }), ipfs: ipfsOf() });
  assert.equal(r.ok, false); assert.match(r.reason, /^revoked/); assert.equal(r.attestation.revoked, true);
  assert.ok(r.texts.every((t) => t.match), 'texts are still shown for a revoked attestation');
  const m = { ...byCid }; delete m[cids.soul];
  r = await verifyCharter({ uid: UID, network: 'base', rpc: chain({ [UID]: att() }), ipfs: ipfsOf(m) });
  assert.equal(r.ok, false); assert.match(r.reason, /^fetch_failed: soul$/);
  const soul = r.texts.find((t) => t.name === 'soul');
  assert.equal(soul.match, false); assert.equal(soul.actual, null); assert.match(soul.error, /could not fetch/);
  const revert = async () => { const e = new Error('execution reverted'); e.code = 3; throw e; };
  r = await verifyCharter({ uid: UID, network: 'base', rpc: revert, ipfs: ipfsOf() });
  assert.equal(r.ok, false); assert.match(r.reason, /^rpc_error: .*execution reverted/);
  r = await verifyCharter({ uid: UID, network: 'base', rpc: async () => '0x1234', ipfs: ipfsOf() });
  assert.equal(r.ok, false); assert.match(r.reason, /^rpc_error/);
  r = await verifyCharter({ uid: UID, network: 'base', rpc: chain({ [UID]: att({ data: '0xdeadbeef' }) }), ipfs: ipfsOf() });
  assert.equal(r.ok, false); assert.match(r.reason, /^bad_data/);
  assert.match((await verifyCharter({ uid: 'nope', network: 'base', rpc: chain({}), ipfs: ipfsOf() })).reason, /^invalid_uid/);
  assert.match((await verifyCharter({ uid: UID, network: 'mainnet', rpc: chain({}), ipfs: ipfsOf() })).reason, /^unknown_network/);
  assert.match((await verifyCharter()).reason, /^invalid_uid/);
  assert.match((await verifyCharter({ uid: UID, network: 'base' })).reason, /^bad_arguments/);
});

test('A5 works on Base and Base Sepolia, the network choosing the chain and the RPC', async () => {
  assert.equal(NETWORKS.base.chainId, 8453); assert.equal(NETWORKS['base-sepolia'].chainId, 84532);
  assert.notEqual(NETWORKS.base.rpcUrl, NETWORKS['base-sepolia'].rpcUrl);
  const sepoliaOnly = { [UID]: att() };
  const rpcs = { base: chain({}), 'base-sepolia': chain(sepoliaOnly) };
  const onS = await verifyCharter({ uid: UID, network: 'base-sepolia', rpc: rpcs['base-sepolia'], ipfs: ipfsOf() });
  assert.equal(onS.ok, true);
  const onB = await verifyCharter({ uid: UID, network: 'base', rpc: rpcs.base, ipfs: ipfsOf() });
  assert.equal(onB.ok, false); assert.match(onB.reason, /^not_found: .* on Base$/);
  const calls = [];
  await verifyCharter({ uid: UID, network: 'base', rpc: chain({ [UID]: att() }, calls), ipfs: ipfsOf() });
  assert.equal(calls.length, 1, 'one eth_call per verification');
  assert.deepEqual(calls[0].params[0], getAttestationCall(UID)); assert.equal(calls[0].params[1], 'latest');
  // fetch based helpers the page uses: the RPC URL and the gateway are the ones given
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push([url, init && JSON.parse(init.body).method]); return { ok: true, json: async () => ({ result: '0x01' }), arrayBuffer: async () => enc.encode('x').buffer }; };
  assert.equal(await httpRpc(NETWORKS['base-sepolia'].rpcUrl, fakeFetch)('eth_call', []), '0x01');
  assert.deepEqual(seen[0], ['https://sepolia.base.org', 'eth_call']);
  const errFetch = async () => ({ ok: true, json: async () => ({ error: { code: 3, message: 'execution reverted' } }) });
  await assert.rejects(httpRpc('u', errFetch)('eth_call', []), (e) => e.code === 3 && /execution reverted/.test(e.message));
  assert.deepEqual(await gatewayIpfs('https://gw.example/ipfs', fakeFetch)('QmX'), enc.encode('x'));
  assert.equal(seen[1][0], 'https://gw.example/ipfs/QmX');
  await assert.rejects(gatewayIpfs('g', async () => ({ ok: false, status: 404 }))('c'), /404/);
});

test('A6 the page is mobile friendly and wired to the verifier', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /import \{[^}]*verifyCharter[^}]*\} from '\.\/verifier\.js'/);
  assert.match(html, /"viem": "https:\/\/esm\.sh\/viem@2\.21\.45"/, 'viem pinned in the import map');
  assert.match(html, /base-sepolia/); assert.match(html, /max-width/);
  assert.doesNotMatch(html, /[\u2013\u2014]/, 'no long dashes');
});

test.todo('A6 the Sepolia rehearsal UID Kognai publishes on this bundle verifies (UID not published yet; added at M2)');
