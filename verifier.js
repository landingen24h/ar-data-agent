// Charter attestation verifier. Plain ES module: runs in the browser (viem from a pinned CDN through the import map
// in index.html) and in Node 20 (viem from npm). No key, no wallet, no backend.
import { decodeAbiParameters, parseAbiParameters, encodeFunctionData, decodeFunctionResult } from 'viem';

export const CHARTER_SCHEMA = 'string version,string date,string[] names,bytes32[] digests,string[] cids';
export const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
export const NETWORKS = {
  base: { chainId: 8453, name: 'Base', rpcUrl: 'https://mainnet.base.org', explorer: 'https://base.easscan.org' },
  'base-sepolia': { chainId: 84532, name: 'Base Sepolia', rpcUrl: 'https://sepolia.base.org', explorer: 'https://base-sepolia.easscan.org' },
};
export const DEFAULT_GATEWAY = 'https://ipfs.io/ipfs/';

const PARAMS = parseAbiParameters(CHARTER_SCHEMA);
const ZERO32 = '0x' + '0'.repeat(64);
const UID = /^0x[0-9a-fA-F]{64}$/;
const EAS_ABI = [{
  type: 'function', name: 'getAttestation', stateMutability: 'view',
  inputs: [{ name: 'uid', type: 'bytes32' }],
  outputs: [{ name: '', type: 'tuple', components: [
    { name: 'uid', type: 'bytes32' }, { name: 'schema', type: 'bytes32' }, { name: 'time', type: 'uint64' },
    { name: 'expirationTime', type: 'uint64' }, { name: 'revocationTime', type: 'uint64' }, { name: 'refUID', type: 'bytes32' },
    { name: 'recipient', type: 'address' }, { name: 'attester', type: 'address' }, { name: 'revocable', type: 'bool' },
    { name: 'data', type: 'bytes' },
  ] }],
}];

const msg = (e) => (e && typeof e.message === 'string' && e.message) ? e.message : String(e);

/** Decode the attestation data of the Charter schema. Digests come back as 0x and 64 lowercase hex. */
export function decodeCharterData(dataHex) {
  if (typeof dataHex !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(dataHex)) throw new Error('data: expected 0x prefixed hex');
  const [version, date, names, digests, cids] = decodeAbiParameters(PARAMS, dataHex);
  if (names.length !== digests.length || names.length !== cids.length) throw new Error('data: names, digests and cids must have the same length');
  return { version, date, names: [...names], digests: digests.map((d) => d.toLowerCase()), cids: [...cids] };
}

/** sha256 of bytes as 0x and 64 lowercase hex, with Web Crypto (browser and Node 20). */
export async function sha256Hex(bytes) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return '0x' + Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Encode the eth_call that reads one attestation. */
export function getAttestationCall(uid) {
  return { to: EAS_ADDRESS, data: encodeFunctionData({ abi: EAS_ABI, functionName: 'getAttestation', args: [uid] }) };
}

/**
 * Verify the Charter attestation: never throws. ok is true only when the attestation exists, is not revoked,
 * has Charter data and every text fetched from IPFS has the digest on chain.
 */
export async function verifyCharter({ uid, network, rpc, ipfs } = {}) {
  const out = { ok: false, attestation: { uid: typeof uid === 'string' ? uid.toLowerCase() : uid, attester: null, time: null, revoked: false }, texts: [] };
  const fail = (reason) => Object.assign(out, { ok: false, reason });
  if (typeof uid !== 'string' || !UID.test(uid)) return fail('invalid_uid: expected 0x and 64 hex characters');
  if (!Object.prototype.hasOwnProperty.call(NETWORKS, network)) return fail('unknown_network: use base or base-sepolia');
  if (typeof rpc !== 'function' || typeof ipfs !== 'function') return fail('bad_arguments: rpc and ipfs must be functions');
  let a;
  try {
    const raw = await rpc('eth_call', [getAttestationCall(uid), 'latest']);
    a = decodeFunctionResult({ abi: EAS_ABI, functionName: 'getAttestation', data: raw });
  } catch (e) {
    return fail(`rpc_error: could not read the attestation on ${NETWORKS[network].name}: ${msg(e)}`);
  }
  if (!a || a.uid.toLowerCase() === ZERO32) return fail(`not_found: no attestation with this UID on ${NETWORKS[network].name}`);
  out.attestation = { uid: a.uid.toLowerCase(), attester: a.attester, time: Number(a.time), revoked: a.revocationTime !== 0n };
  let d;
  try { d = decodeCharterData(a.data); } catch (e) { return fail(`bad_data: the attestation data is not the Charter schema: ${msg(e)}`); }
  out.version = d.version; out.date = d.date;
  for (let i = 0; i < d.names.length; i++) {
    const t = { name: d.names[i], cid: d.cids[i], expected: d.digests[i], actual: null, match: false };
    try {
      const bytes = await ipfs(d.cids[i]);
      if (!(bytes instanceof Uint8Array)) throw new Error('ipfs did not return bytes');
      t.actual = await sha256Hex(bytes);
      t.match = t.actual === t.expected;
    } catch (e) {
      t.error = `could not fetch ${d.cids[i]}: ${msg(e)}`;
    }
    out.texts.push(t);
  }
  if (out.attestation.revoked) return fail('revoked: this attestation was revoked');
  if (out.texts.length === 0) return fail('no_texts: the attestation lists no text');
  const bad = out.texts.filter((t) => !t.match);
  if (bad.length) return fail((bad.some((t) => t.error) ? 'fetch_failed: ' : 'mismatch: ') + bad.map((t) => t.name).join(', '));
  out.ok = true;
  delete out.reason;
  return out;
}

/** fetch based helpers used by the page. */
export function httpRpc(url, fetchFn = globalThis.fetch) {
  let id = 0;
  return async (method, params) => {
    const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) { const e = new Error(`${j.error.code} ${j.error.message}`); e.code = j.error.code; throw e; }
    return j.result;
  };
}
export function gatewayIpfs(gateway = DEFAULT_GATEWAY, fetchFn = globalThis.fetch) {
  const base = gateway.endsWith('/') ? gateway : gateway + '/';
  return async (cid) => {
    const r = await fetchFn(base + encodeURIComponent(cid));
    if (!r.ok) throw new Error(`gateway HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
}
