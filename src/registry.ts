import { verifyKogFee, type Quote, type SeenStore } from './verify-fee.ts';

/** In memory store for the registry. Every write happens only after the fee gate said yes. */
export interface Store {
  offers: Map<string, any>;
  jobs: Map<string, { id: string; bids: any[] }>;
  /** Signatures of fees already spent. Shared by offers and bids, so one fee pays for one write only. */
  usedFees: SeenStore & { size?: number };
}
export const createStore = (jobIds: string[] = []): Store => ({
  offers: new Map(),
  jobs: new Map(jobIds.map((id) => [id, { id, bids: [] }])),
  usedFees: new Set<string>(),
});

export type Kind = 'offer' | 'bid';
export interface FeeConfig {
  payee: string;
  mint: string;
  /** The fee quote for this kind of write: amount in base units, validity window. */
  quote(kind: Kind): Quote;
  /** Loads the parsed transaction for a signature (getTransaction jsonParsed). null when unknown. */
  getTx(signature: string): Promise<any | null>;
}
export interface Req { method: string; path: string; headers?: Record<string, string | undefined>; body?: any }
export interface Res { status: number; body: any }

export const FEE_HEADER = 'x-kog-fee';
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Minimal LAX registry handler with the KOG fee gate on POST /offers and POST /jobs/<id>/bids.
 * Order: route, body validation, then the fee. A request that would be refused for its body never spends a fee.
 */
export function createRegistry(store: Store, fee: FeeConfig) {
  async function gate(kind: Kind, headers: Req['headers']): Promise<Res | null> {
    const proof = headers?.[FEE_HEADER]?.trim();
    const quote = fee.quote(kind);
    if (!proof) return { status: 402, body: { error: 'fee_required', kind, quote, payee: fee.payee, mint: fee.mint } };
    if (!SIG.test(proof)) return { status: 402, body: { error: 'fee_refused', reason: 'malformed_proof' } };
    if (store.usedFees.has(proof)) return { status: 402, body: { error: 'fee_refused', reason: 'replayed' } };
    const tx = await fee.getTx(proof);
    if (!tx) return { status: 402, body: { error: 'fee_refused', reason: 'unknown_tx' } };
    if (tx?.transaction?.signatures?.[0] !== proof) return { status: 402, body: { error: 'fee_refused', reason: 'signature_mismatch' } };
    // verifyKogFee is synchronous and records the signature in usedFees on success, so two concurrent
    // requests with the same fee cannot both pass after the await above.
    const r = verifyKogFee({ tx, quote, payee: fee.payee, mint: fee.mint, seen: store.usedFees });
    return r.ok ? null : { status: 402, body: { error: 'fee_refused', reason: r.reason } };
  }

  async function handle(req: Req): Promise<Res> {
    const m = req.method.toUpperCase();
    if (m === 'POST' && req.path === '/offers') {
      const o = req.body;
      if (!o || typeof o.id !== 'string' || !o.id) return { status: 400, body: { error: 'invalid_offer' } };
      if (store.offers.has(o.id)) return { status: 409, body: { error: 'offer_exists' } };
      const refused = await gate('offer', req.headers);
      if (refused) return refused;
      store.offers.set(o.id, o);
      return { status: 201, body: { offer: o } };
    }
    const bid = m === 'POST' ? /^\/jobs\/([^/]+)\/bids$/.exec(req.path) : null;
    if (bid) {
      const job = store.jobs.get(bid[1]);
      if (!job) return { status: 404, body: { error: 'job_not_found' } };
      const b = req.body;
      if (!b || typeof b.offer_id !== 'string' || !(Number(b.price_usdc) > 0)) return { status: 400, body: { error: 'invalid_bid' } };
      const refused = await gate('bid', req.headers);
      if (refused) return refused;
      const row = { ...b, job_id: job.id, status: 'submitted' };
      job.bids.push(row);
      return { status: 201, body: { bid: row } };
    }
    return { status: 404, body: { error: 'not_found' } };
  }
  return { handle };
}
