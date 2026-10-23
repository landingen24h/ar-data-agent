/**
 * Cerberus chamber 1: identity of a listed LAX agent.
 *
 * createChallenge builds a one time challenge (agent DID, listing id, nonce, expiry).
 * verifyChallenge checks the EIP-191 personal_sign signature of the listing owner
 * address over the canonical text of that challenge. No network: everything is local.
 */
import { getAddress, isAddress, isHex, recoverMessageAddress, type Hex } from 'viem';

export interface Challenge {
  did: string;
  listingId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export type Reason =
  | 'ok'
  | 'malformed_challenge'
  | 'malformed_signature'
  | 'malformed_owner'
  | 'not_yet_valid'
  | 'expired'
  | 'replayed_nonce'
  | 'wrong_signer';

export interface VerifyResult {
  ok: boolean;
  reason: Reason;
}

/** Remembers spent nonces. The default is in memory; pass your own (database, KV) to share it across processes. */
export interface NonceStore {
  has(nonce: string): boolean;
  add(nonce: string, expiresAtMs: number): void;
}

export const DEFAULT_TTL_MS = 5 * 60 * 1000;
export const MAX_TTL_MS = 60 * 60 * 1000;
const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]{1,200}$/;
const LISTING_RE = /^[A-Za-z0-9._-]{1,128}$/;
const NONCE_RE = /^[0-9a-f]{64}$/;

export function memoryNonceStore(): NonceStore & { size(): number } {
  const seen = new Map<string, number>();
  return {
    has: (n) => seen.has(n),
    add: (n, exp) => {
      seen.set(n, exp);
    },
    size: () => seen.size,
  };
}

const defaultStore = memoryNonceStore();

function toMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

function randomNonce(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function createChallenge(input: {
  did: string;
  listingId: string;
  now: Date | number;
  ttlMs?: number;
  nonce?: string;
}): Challenge {
  const { did, listingId } = input;
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  if (typeof did !== 'string' || !DID_RE.test(did)) throw new TypeError('did must be a DID like did:pkh:eip155:8453:0x...');
  if (typeof listingId !== 'string' || !LISTING_RE.test(listingId)) throw new TypeError('listingId must be 1 to 128 of A-Z a-z 0-9 . _ -');
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) throw new RangeError('ttlMs must be an integer from 1 to 3600000');
  const nonce = input.nonce ?? randomNonce();
  if (!NONCE_RE.test(nonce)) throw new TypeError('nonce must be 64 lowercase hex characters');
  const t = toMs(input.now);
  if (!Number.isFinite(t)) throw new TypeError('now must be a valid date');
  return { did, listingId, nonce, issuedAt: new Date(t).toISOString(), expiresAt: new Date(t + ttl).toISOString() };
}

/** The exact text the listing owner signs with personal_sign (EIP-191, version 0x45). */
export function challengeMessage(c: Challenge): string {
  return [
    'Kognai LAX listing ownership challenge',
    `DID: ${c.did}`,
    `Listing: ${c.listingId}`,
    `Nonce: ${c.nonce}`,
    `Issued at: ${c.issuedAt}`,
    `Expires at: ${c.expiresAt}`,
  ].join('\n');
}

function wellFormed(c: unknown): c is Challenge {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  if (typeof x.did !== 'string' || !DID_RE.test(x.did)) return false;
  if (typeof x.listingId !== 'string' || !LISTING_RE.test(x.listingId)) return false;
  if (typeof x.nonce !== 'string' || !NONCE_RE.test(x.nonce)) return false;
  if (typeof x.issuedAt !== 'string' || typeof x.expiresAt !== 'string') return false;
  const i = Date.parse(x.issuedAt);
  const e = Date.parse(x.expiresAt);
  if (!Number.isFinite(i) || !Number.isFinite(e)) return false;
  return e > i && e - i <= MAX_TTL_MS;
}

export async function verifyChallenge(input: {
  challenge: Challenge;
  signature: string;
  ownerAddress: string;
  now: Date | number;
  store?: NonceStore;
}): Promise<VerifyResult> {
  const store = input.store ?? defaultStore;
  const { challenge, signature, ownerAddress } = input;
  if (!wellFormed(challenge)) return { ok: false, reason: 'malformed_challenge' };
  if (typeof signature !== 'string' || !isHex(signature) || signature.length !== 132) return { ok: false, reason: 'malformed_signature' };
  if (typeof ownerAddress !== 'string' || !isAddress(ownerAddress, { strict: false })) return { ok: false, reason: 'malformed_owner' };
  const t = toMs(input.now);
  if (t < Date.parse(challenge.issuedAt)) return { ok: false, reason: 'not_yet_valid' };
  if (t >= Date.parse(challenge.expiresAt)) return { ok: false, reason: 'expired' };
  if (store.has(challenge.nonce)) return { ok: false, reason: 'replayed_nonce' };
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: challengeMessage(challenge), signature: signature as Hex });
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  if (getAddress(signer) !== getAddress(ownerAddress)) return { ok: false, reason: 'wrong_signer' };
  store.add(challenge.nonce, Date.parse(challenge.expiresAt));
  return { ok: true, reason: 'ok' };
}
