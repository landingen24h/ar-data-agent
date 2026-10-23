// ERC-8004 identity viewer. Plain ES module: runs in the browser (viem from a pinned CDN through the import map
// in index.html) and in Node 20 (viem from node_modules). No backend, no key, no wallet.
import { encodeFunctionData, decodeFunctionResult, parseAbi } from 'viem';
import { REGISTRIES, DEFAULT_GATEWAY } from './config.js';

export const ABI = parseAbi([
  'function ownerOf(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 agentId) view returns (string)',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';

export function parseAgentId(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,78}$/.test(s)) return null;
  const n = BigInt(s);
  return n < 2n ** 256n ? n : null;
}

export function isRevert(err) {
  return err?.code === 3 || /revert/i.test(String(err?.message ?? ''));
}

export function ipfsToHttp(uri, gateway = DEFAULT_GATEWAY) {
  const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  return gateway.replace(/\/?$/, '/') + path;
}

// data:[<mediatype>][;base64],<data>, only JSON media types (or none) are accepted.
export function decodeDataUri(uri) {
  const m = /^data:([^,]*),(.*)$/s.exec(uri);
  if (!m) throw new Error('Malformed data: URI');
  const meta = m[1].split(';').map((x) => x.trim().toLowerCase());
  const type = meta[0] || 'application/json';
  if (!/^application\/([a-z0-9.+-]*\+)?json$/.test(type) && type !== 'text/plain') throw new Error(`Unsupported data: media type ${type}`);
  let text;
  if (meta.includes('base64')) {
    const bin = atob(m[2].replace(/\s/g, ''));
    text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } else {
    text = decodeURIComponent(m[2]);
  }
  return JSON.parse(text);
}

// The registration file behind a tokenURI: data: decoded locally, ipfs:// through a gateway, https as is.
export async function readRegistration(uri, fetchJson, gateway = DEFAULT_GATEWAY) {
  if (!uri) return null;
  if (uri.startsWith('data:')) return decodeDataUri(uri);
  if (uri.startsWith('ipfs://')) return fetchJson(ipfsToHttp(uri, gateway));
  if (/^https?:\/\//i.test(uri)) return fetchJson(uri);
  throw new Error(`Unsupported tokenURI scheme: ${uri.split(':')[0]}`);
}

async function ethCall(rpc, to, functionName, args) {
  const data = encodeFunctionData({ abi: ABI, functionName, args });
  const out = await rpc('eth_call', [{ to, data }, 'latest']);
  return decodeFunctionResult({ abi: ABI, functionName, data: out });
}

export function summarise([clients, indexes, values, decimals, tag1s, tag2s, revoked]) {
  const items = [];
  for (let i = 0; i < clients.length; i++) {
    if (revoked[i]) continue;
    items.push({
      client: clients[i],
      index: Number(indexes[i]),
      score: Number(values[i]) / 10 ** decimals[i],
      tags: [tag1s[i], tag2s[i]].filter(Boolean),
    });
  }
  const count = items.length;
  const average = count ? Math.round((items.reduce((a, x) => a + x.score, 0) / count) * 100) / 100 : null;
  // newest first: the registry appends per client, so the last entries returned are the most recent
  return { count, average, items: items.reverse() };
}

// loadAgent never throws. status: ok | empty (no such agent) | error (RPC or file failed, plain message).
export async function loadAgent({ agentId, network, identityRegistry, reputationRegistry, rpc, fetchJson, gateway } = {}) {
  const base = { status: 'error', agentId: String(agentId ?? ''), owner: null, tokenURI: null, registration: null, feedback: null };
  const id = parseAgentId(agentId);
  if (id === null) return { ...base, error: 'The agent id must be a whole number (the ERC-721 token id).' };
  const reg = REGISTRIES[network];
  const identity = identityRegistry ?? reg?.identity;
  if (!identity) return { ...base, error: `Unknown network "${network}" and no identity registry given.` };
  if (typeof rpc !== 'function') return { ...base, error: 'No RPC function given.' };
  const r = { ...base, agentId: id.toString() };
  try {
    r.owner = await ethCall(rpc, identity, 'ownerOf', [id]);
  } catch (e) {
    if (isRevert(e)) return { ...r, status: 'empty' };
    return { ...r, error: `The RPC call failed: ${e?.message ?? e}` };
  }
  if (!r.owner || r.owner.toLowerCase() === ZERO) return { ...r, owner: null, status: 'empty' };
  try {
    r.tokenURI = await ethCall(rpc, identity, 'tokenURI', [id]);
  } catch (e) {
    return { ...r, error: `Reading the tokenURI failed: ${e?.message ?? e}` };
  }
  if (reputationRegistry) {
    try {
      r.feedback = summarise(await ethCall(rpc, reputationRegistry, 'readAllFeedback', [id, [], '', '', false]));
    } catch (e) {
      return { ...r, error: `Reading the reputation registry failed: ${e?.message ?? e}` };
    }
  }
  try {
    const file = await readRegistration(r.tokenURI, fetchJson, gateway);
    if (file !== null && (typeof file !== 'object' || Array.isArray(file))) throw new Error('it is not a JSON object');
    r.registration = file;
  } catch (e) {
    return { ...r, error: `The registration file could not be read: ${e?.message ?? e}` };
  }
  return { ...r, status: 'ok' };
}

// What the page shows from a registration file (registration-v1 uses services; older files use endpoints).
export function describe(registration) {
  const g = registration ?? {};
  const list = Array.isArray(g.services) ? g.services : Array.isArray(g.endpoints) ? g.endpoints : [];
  return {
    name: typeof g.name === 'string' ? g.name : null,
    description: typeof g.description === 'string' ? g.description : null,
    image: typeof g.image === 'string' ? g.image : null,
    endpoints: list.filter((x) => x && typeof x === 'object').map((x) => ({ name: String(x.name ?? ''), endpoint: String(x.endpoint ?? ''), version: x.version ? String(x.version) : null })),
    supportedTrust: Array.isArray(g.supportedTrust) ? g.supportedTrust.map(String) : [],
  };
}

export function httpRpc(url, fetchFn = globalThis.fetch) {
  let n = 0;
  return async (method, params) => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from the RPC`), { code: res.status });
    const j = await res.json();
    if (j.error) throw Object.assign(new Error(j.error.message || 'JSON-RPC error'), { code: j.error.code, data: j.error.data });
    return j.result;
  };
}

export function httpFetchJson(fetchFn = globalThis.fetch) {
  return async (url) => {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  };
}
