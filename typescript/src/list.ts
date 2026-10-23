/** What the registry answers with 402: the version 1 body or the version 2 PAYMENT-REQUIRED header, decoded. */
export interface PaymentRequired {
  x402Version: number;
  accepts: unknown[];
  [k: string]: unknown;
}

export interface ListOfferOptions {
  offer: Record<string, unknown>;
  /** Default https://lax.kognai.ai/registry */
  registryUrl?: string;
  fetch?: typeof fetch;
  /** Builds the payment header value for these terms. The caller holds the key; it never reaches this module. */
  pay(paymentRequired: PaymentRequired): Promise<string>;
}

export class ListOfferError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ListOfferError'; this.status = status; }
}

function decodeHeader(v: string | null): PaymentRequired | null {
  if (!v) return null;
  try { return JSON.parse(Buffer.from(v, 'base64').toString('utf8')); } catch { return null; }
}

/**
 * Lists an offer on LAX: POST <registry>/offers; on 402 it calls pay() and posts again with
 * PAYMENT-SIGNATURE (x402 version 2 terms) or X-PAYMENT (version 1). Returns the listing id. Never logs.
 */
export async function listOffer(opts: ListOfferOptions): Promise<{ id: string; transaction?: string | null }> {
  const f = opts.fetch || globalThis.fetch;
  const base = (opts.registryUrl || 'https://lax.kognai.ai/registry').replace(/\/+$/, '');
  const body = JSON.stringify(opts.offer);
  const post = (headers: Record<string, string> = {}) => f(`${base}/offers`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  let r = await post();
  if (r.status === 402) {
    let terms = decodeHeader(r.headers.get('payment-required'));
    let parsed: any = null;
    try { parsed = await r.json(); } catch { parsed = null; }
    if (!terms && parsed && Array.isArray(parsed.accepts)) terms = parsed;
    if (!terms) throw new ListOfferError('the registry answered 402 without payment terms', 402);
    const value = await opts.pay(terms);
    if (typeof value !== 'string' || !value) throw new ListOfferError('pay() returned no payment header', 402);
    r = await post(terms.x402Version === 2 ? { 'PAYMENT-SIGNATURE': value } : { 'X-PAYMENT': value });
  }
  let out: any = null;
  try { out = await r.json(); } catch { out = null; }
  if (!r.ok || !out || typeof out.id !== 'string') throw new ListOfferError((out && (out.error || out.message)) || `registry answered ${r.status}`, r.status);
  return { id: out.id, transaction: out.transaction ?? null };
}
