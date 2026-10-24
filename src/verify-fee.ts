export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type Reason =
  | 'ok'
  | 'malformed_tx'
  | 'malformed_quote'
  | 'tx_failed'
  | 'quote_mismatch'
  | 'quote_expired'
  | 'paid_before_quote'
  | 'reference_missing'
  | 'replayed'
  | 'wrong_program'
  | 'wrong_mint'
  | 'wrong_payee'
  | 'short_fee';

export interface Quote {
  /** Fee in base units of the mint, as a decimal string. */
  amount: string;
  /** Unix seconds or an ISO 8601 date. The payment must land at or before this time. */
  expiresAt: number | string;
  /** Optional: unix seconds or ISO date the quote was issued. A payment that landed before it is refused. */
  issuedAt?: number | string;
  /** Optional: if set, must equal the payee and mint given to the verifier. */
  payee?: string;
  mint?: string;
  /** Optional Solana Pay style reference key that must appear in the transaction account keys. */
  reference?: string;
}
export interface SeenStore { has(sig: string): boolean; add(sig: string): unknown }
export interface VerifyInput { tx: any; quote: Quote; payee: string; mint: string; seen: SeenStore }
export interface VerifyResult { ok: boolean; reason: Reason; signature?: string; received?: string }

const DIGITS = /^[0-9]+$/;
const fail = (reason: Reason, extra: Partial<VerifyResult> = {}): VerifyResult => ({ ok: false, reason, ...extra });

function toUnix(v: number | string | undefined): number | undefined | null {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.length > 0) { const ms = Date.parse(v); return Number.isNaN(ms) ? null : Math.floor(ms / 1000); }
  return null;
}
function keyOf(k: any): string | undefined { return typeof k === 'string' ? k : typeof k?.pubkey === 'string' ? k.pubkey : undefined; }

/**
 * Pure verifier: the parsed transaction (getTransaction with encoding jsonParsed) is passed in, there is no RPC.
 * What counts is what the payee actually received in the mint under Token 2022, as the change of its token balances
 * (post minus pre). With a transfer fee extension that is the net amount, so a fee is never accepted short.
 * The signature is added to seen only when every check passes.
 */
export function verifyKogFee({ tx, quote, payee, mint, seen }: VerifyInput): VerifyResult {
  const sig = tx?.transaction?.signatures?.[0];
  const meta = tx?.meta;
  if (typeof sig !== 'string' || !meta || !Array.isArray(meta.postTokenBalances) || !Number.isInteger(tx?.blockTime))
    return fail('malformed_tx');
  const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
  if (meta.err !== null && meta.err !== undefined) return fail('tx_failed', { signature: sig });

  const expiresAt = toUnix(quote?.expiresAt);
  const issuedAt = toUnix(quote?.issuedAt);
  if (!quote || typeof quote.amount !== 'string' || !DIGITS.test(quote.amount) || BigInt(quote.amount) <= 0n || expiresAt == null || issuedAt === null)
    return fail('malformed_quote', { signature: sig });
  if (!payee || !mint) return fail('malformed_quote', { signature: sig });
  if ((quote.payee !== undefined && quote.payee !== payee) || (quote.mint !== undefined && quote.mint !== mint))
    return fail('quote_mismatch', { signature: sig });
  if (tx.blockTime > expiresAt) return fail('quote_expired', { signature: sig });
  if (issuedAt !== undefined && tx.blockTime < issuedAt) return fail('paid_before_quote', { signature: sig });
  if (quote.reference !== undefined) {
    const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
    if (!keys.some((k) => keyOf(k) === quote.reference)) return fail('reference_missing', { signature: sig });
  }
  if (seen.has(sig)) return fail('replayed', { signature: sig });

  const preBy = new Map<number, any>(pre.map((b: any) => [b.accountIndex, b]));
  let received = 0n;
  let mintMoved = false;
  let mintOtherProgram = false;
  for (const post of meta.postTokenBalances) {
    if (post?.mint !== mint) continue;
    const before = preBy.get(post.accountIndex);
    const a = post?.uiTokenAmount?.amount;
    const b = before?.uiTokenAmount?.amount ?? '0';
    if (typeof a !== 'string' || !DIGITS.test(a) || typeof b !== 'string' || !DIGITS.test(b)) return fail('malformed_tx', { signature: sig });
    const delta = BigInt(a) - BigInt(b);
    if (post.programId !== TOKEN_2022) { if (delta !== 0n) mintOtherProgram = true; continue; }
    if (delta !== 0n) mintMoved = true;
    if (post.owner === payee && delta > 0n) received += delta;
  }
  if (received === 0n) {
    if (mintOtherProgram) return fail('wrong_program', { signature: sig });
    return fail(mintMoved ? 'wrong_payee' : 'wrong_mint', { signature: sig });
  }
  if (received < BigInt(quote.amount)) return fail('short_fee', { signature: sig, received: received.toString() });
  seen.add(sig);
  return { ok: true, reason: 'ok', signature: sig, received: received.toString() };
}
