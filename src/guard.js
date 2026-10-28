// Replay lock + global daily budget for /ar/brief (the route that spends our own money upstream).
//
// Why: x402 verifies the caller's payment, runs the handler, then settles. /ar/brief buys an
// LLM completion inside the handler, i.e. BEFORE the caller's payment is settled on chain. Without
// a lock, the same signed payment replayed N times in parallel passes verify N times (its EIP-3009
// nonce is not used on chain yet), we buy N completions and only one settlement succeeds.
// Also, an in-memory daily counter is per isolate, so on Workers it is not a real cap.
// (Reported by Zealynx on the Celo forum, 26 Oct 2026.)
//
// Fix: before any upstream purchase, (1) claim the caller's payment key (payer + EIP-3009 nonce)
// in a store that is global and serialized, and refuse a key seen before; (2) take one unit of a
// global per-UTC-day budget. On Workers the store is one Durable Object (BriefGuard), which runs
// one request at a time, so both checks are atomic across isolates. If no guard is configured,
// /ar/brief stays OFF (fail closed).
//
// Per-payer cap (reported by Zealynx, 28 Oct 2026): one funded address can sign many
// authorizations with different nonces; each passes verify on its own, so one payer could use up
// the whole day's budget for everyone. take(payer) also takes one unit of that payer's own
// per-UTC-day quota (default 2) in the same serialized step, so no single address can drain the
// shared budget.

/** Payment key from an x402 payment header (v2 PAYMENT-SIGNATURE or v1 X-PAYMENT), or null. */
export function paymentKey(header) {
  if (!header || typeof header !== 'string' || header.length > 16384) return null;
  let p;
  try { p = JSON.parse(atob(header)); } catch { return null; }
  const a = p && p.payload && p.payload.authorization;
  if (!a || typeof a.from !== 'string' || typeof a.nonce !== 'string') return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from) || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return null;
  return `${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`;
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Core logic shared by the in-memory guard and the Durable Object. `kv` is a Map-like async store. */
export const DEFAULT_MAX_PER_PAYER = 2;
const payerOf = (x) => (typeof x === 'string' && /^0x[0-9a-f]{40}$/.test(x.toLowerCase()) ? x.toLowerCase() : null);
/** Payer address from a payment key ("0xfrom:0xnonce"), or null. */
export const payerFromKey = (key) => (typeof key === 'string' ? payerOf(key.split(':')[0]) : null);

export function guardLogic(kv, { maxPerDay, maxPerPayer = DEFAULT_MAX_PER_PAYER, now = () => Date.now(), keyTtlMs = 2 * 86400e3 }) {
  return {
    async claim(key) {
      if (!key) return false;
      const k = 'k:' + key;
      if (await kv.get(k)) return false;
      await kv.put(k, now() + keyTtlMs);
      return true;
    },
    async take(payer) {
      const day = today(now()), k = 'd:' + day;
      const used = Number((await kv.get(k)) || 0);
      if (used >= maxPerDay) return false;
      const who = payer === undefined ? null : payerOf(payer);
      if (payer !== undefined && !who) return false;
      if (who) {
        const pk = 'p:' + day + ':' + who, pu = Number((await kv.get(pk)) || 0);
        if (pu >= maxPerPayer) return false;
        await kv.put(pk, pu + 1);
      }
      await kv.put(k, used + 1);
      return true;
    },
  };
}

/** Single-process guard (local Node server and tests). NOT global across Worker isolates. */
// Synchronous check-and-set, so parallel requests in one process cannot interleave between get and put.
export function memoryGuard(maxPerDay = 20, { now = () => Date.now(), maxPerPayer = DEFAULT_MAX_PER_PAYER } = {}) {
  const keys = new Set(), days = new Map();
  return {
    async claim(key) { if (!key || keys.has(key)) return false; keys.add(key); return true; },
    async take(payer) {
      const d = today(now()), u = days.get(d) || 0; if (u >= maxPerDay) return false;
      const who = payer === undefined ? null : payerOf(payer);
      if (payer !== undefined && !who) return false;
      if (who) { const pk = d + ':' + who, pu = days.get(pk) || 0; if (pu >= maxPerPayer) return false; days.set(pk, pu + 1); }
      days.set(d, u + 1); return true;
    },
  };
}

/** Client for the BriefGuard Durable Object binding (one global instance). */
export function durableGuard(ns, maxPerDay = 20, maxPerPayer = DEFAULT_MAX_PER_PAYER) {
  const stub = () => ns.get(ns.idFromName('global'));
  const call = async (op, key) => {
    const r = await stub().fetch('https://guard/' + op, { method: 'POST', body: JSON.stringify({ key, maxPerDay, maxPerPayer }) });
    if (!r.ok) return false; // any error: refuse (fail closed, nothing bought)
    return (await r.json()).ok === true;
  };
  return { claim: key => (key ? call('claim', key) : Promise.resolve(false)), take: (payer) => call('take', payer) };
}

/** Durable Object: serializes claim/take for every isolate (input gates keep get+put atomic).
 *  Old keys are dropped by an alarm. Wrangler: [[durable_objects.bindings]] name = "BRIEF_GUARD", class_name = "BriefGuard"
 *  and a [[migrations]] entry with new_sqlite_classes = ["BriefGuard"]. */
export class BriefGuard {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const op = new URL(req.url).pathname.slice(1);
    const { key, maxPerDay, maxPerPayer } = await req.json().catch(() => ({}));
    const st = this.state.storage;
    const g = guardLogic({ get: k => st.get(k), put: (k, v) => st.put(k, v) }, { maxPerDay: Number(maxPerDay) || 20, maxPerPayer: Number(maxPerPayer) || DEFAULT_MAX_PER_PAYER });
    let ok = false;
    if (op === 'claim') ok = await g.claim(key);
    else if (op === 'take') ok = await g.take(key);
    else return new Response('not found', { status: 404 });
    if (st.getAlarm && !(await st.getAlarm())) await st.setAlarm(Date.now() + 86400e3);
    return Response.json({ ok });
  }
  async alarm() {
    const st = this.state.storage, now = Date.now(), old = [];
    for (const [k, v] of await st.list()) {
      if ((k.startsWith('k:') && Number(v) < now) || (k.startsWith('d:') && k.slice(2) < today(now - 86400e3)) || (k.startsWith('p:') && k.slice(2, 12) < today(now - 86400e3))) old.push(k);
    }
    for (let i = 0; i < old.length; i += 128) await st.delete(old.slice(i, i + 128));
    await st.setAlarm(now + 86400e3);
  }
}
