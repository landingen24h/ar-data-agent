import { readFileSync } from 'node:fs';
import { createRegistry, createStore, FEE_HEADER, type Kind } from '../src/registry.ts';

// Recorded from Solana mainnet on 2026-10-23 with getTransaction, encoding jsonParsed, unmodified.
// The KOG mint is not public yet, so a real Token 2022 fee transfer (PYUSD) stands in for it.
const load = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
export const T22 = load('pyusd-transfer.json');
export const SPL = load('usdc-transfer.json');
export const MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
export const PAYEE = '4CFZKmFLBpWp8pkAEt7w4RTy4nYhajuH6VHHi76az3sT';
export const PAID = '304533611451';
export const SIG = T22.transaction.signatures[0] as string;
export const SPL_SIG = SPL.transaction.signatures[0] as string;
export const JOB = 'job-1';
export { FEE_HEADER };

export interface Setup { fee?: Partial<Record<Kind, string>>; txs?: any[]; ungated?: boolean }

/** A fresh registry with an in memory store. UNGATED=1 swaps in a registry with no fee check, to prove the tests catch it. */
export function setup(o: Setup = {}) {
  const store = createStore([JOB]);
  const txs = new Map((o.txs ?? [T22, SPL]).map((t) => [t.transaction.signatures[0], t]));
  const fee = {
    payee: PAYEE,
    mint: MINT,
    quote: (kind: Kind) => ({ amount: o.fee?.[kind] ?? PAID, issuedAt: T22.blockTime - 60, expiresAt: T22.blockTime + 60 }),
    getTx: async (s: string) => txs.get(s) ?? null,
  };
  const ungated = o.ungated ?? process.env.UNGATED === '1';
  const registry = createRegistry(store, ungated ? { ...fee, getTx: async () => null } : fee);
  const handle = ungated
    ? async (req: any) => registry.handle({ ...req, headers: {} }).then((r) => (r.status === 402 ? passThrough(store, req) : r))
    : registry.handle;
  return { store, handle };
}

// The "no gate" registry: same routes and validation, writes on any request. Used only by the gate proof.
function passThrough(store: any, req: any) {
  if (req.path === '/offers') { store.offers.set(req.body.id, req.body); return { status: 201, body: { offer: req.body } }; }
  const id = req.path.split('/')[2];
  const row = { ...req.body, job_id: id, status: 'submitted' };
  store.jobs.get(id).bids.push(row);
  return { status: 201, body: { bid: row } };
}

export const offerReq = (id: string, sig?: string) => ({ method: 'POST', path: '/offers', headers: sig === undefined ? {} : { [FEE_HEADER]: sig }, body: { id } });
export const bidReq = (sig?: string, job = JOB) => ({ method: 'POST', path: `/jobs/${job}/bids`, headers: sig === undefined ? {} : { [FEE_HEADER]: sig }, body: { offer_id: 'lax-ext-1', price_usdc: 10 } });
