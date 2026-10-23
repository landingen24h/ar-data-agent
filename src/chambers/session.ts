/**
 * Cerberus chamber 5: session token. After the four chambers pass, the airlock issues a
 * short lived token (HMAC-SHA256 over a base64url JSON payload). verifyToken refuses a
 * tampered payload or MAC, an expired token and a token from the future.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_SESSION_MS = 60 * 60 * 1000;

export interface SessionClaims {
  sub: string;
  listing: string;
  job: string;
  tier: string;
  iat: number;
  exp: number;
}

export type SessionReason = 'ok' | 'malformed_token' | 'bad_signature' | 'not_yet_valid' | 'expired';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest();

export function issueToken(input: { sub: string; listing: string; job: string; tier: string; now: number; ttlMs: number; secret: string }): string {
  if (typeof input.secret !== 'string' || input.secret.length < 32) throw new TypeError('secret must be at least 32 characters');
  if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_SESSION_MS) throw new RangeError('ttlMs must be from 1 to 3600000');
  const claims: SessionClaims = { sub: input.sub, listing: input.listing, job: input.job, tier: input.tier, iat: input.now, exp: input.now + input.ttlMs };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${b64(mac(input.secret, payload))}`;
}

export function verifyToken(token: unknown, secret: string, now: number): { ok: boolean; reason: SessionReason; claims?: SessionClaims } {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed_token' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed_token' };
  const given = Buffer.from(parts[1], 'base64url');
  const want = mac(secret, parts[0]);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: 'bad_signature' };
  let c: SessionClaims;
  try {
    c = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (!c || typeof c.iat !== 'number' || typeof c.exp !== 'number') return { ok: false, reason: 'malformed_token' };
  if (now < c.iat) return { ok: false, reason: 'not_yet_valid' };
  if (now >= c.exp) return { ok: false, reason: 'expired' };
  return { ok: true, reason: 'ok', claims: c };
}
