import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';

/** Fields of a Sign in with Solana message. */
export interface SiwsFields {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  chainId?: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export interface CreateMessageParams {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  chainId?: string;
  /** Defaults to 16 random bytes in base58. */
  nonce?: string;
  /** Defaults to now. */
  issuedAt?: Date | string;
  /** Defaults to issuedAt plus ttlMs. */
  expirationTime?: Date | string;
  /** Default 5 minutes, maximum 1 hour. */
  ttlMs?: number;
}

/** Store of spent nonces. A Set works, or any shared store with the same two methods. */
export interface NonceStore {
  has(nonce: string): boolean;
  add(nonce: string): unknown;
}

export type Reason =
  | 'ok'
  | 'malformed_message'
  | 'malformed_signature'
  | 'malformed_address'
  | 'address_mismatch'
  | 'wrong_domain'
  | 'not_yet_valid'
  | 'expired'
  | 'replayed_nonce'
  | 'not_on_allowlist'
  | 'bad_signature';

export interface VerifyParams {
  message: string;
  /** 64 bytes, as Uint8Array or base58. */
  signature: Uint8Array | string;
  /** Base58 public key of the wallet that claims to sign. */
  address: string;
  /** Base58 addresses allowed to sign in. */
  allowlist: Iterable<string>;
  /** The domain this server expects. Defaults to no check only if omitted on purpose. */
  domain?: string;
  now?: Date;
  /** Spent nonces. A nonce is recorded only after every check passes. */
  seen?: NonceStore;
  /** Allowed clock skew for issuedAt, default 60 seconds. */
  skewMs?: number;
}

export interface VerifyResult {
  ok: boolean;
  reason: Reason;
  fields?: SiwsFields;
}

const HEADER = ' wants you to sign in with your Solana account:';
const DEFAULT_TTL = 5 * 60 * 1000;
const MAX_TTL = 60 * 60 * 1000;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/;
const NONCE_RE = /^[A-Za-z0-9]{8,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** True when s is a base58 string that decodes to a 32 byte ed25519 public key on the curve. */
export function isAddress(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try {
    const b = base58.decode(s);
    if (b.length !== 32) return false;
    ed25519.ExtendedPoint.fromHex(b);
    return true;
  } catch {
    return false;
  }
}

function iso(d: Date | string, name: string): string {
  const t = typeof d === 'string' ? new Date(d) : d;
  if (!(t instanceof Date) || Number.isNaN(t.getTime())) throw new TypeError(`invalid ${name}`);
  return t.toISOString();
}

function clean(v: string | undefined, name: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0 || v.length > 512 || /[\r\n]/.test(v)) throw new TypeError(`invalid ${name}`);
  return v;
}

/** Builds the canonical message text. Throws TypeError on bad input. */
export function createMessage(p: CreateMessageParams): string {
  if (typeof p?.domain !== 'string' || !DOMAIN_RE.test(p.domain)) throw new TypeError('invalid domain');
  if (!isAddress(p.address)) throw new TypeError('invalid address');
  const nonce = p.nonce ?? base58.encode(ed25519.utils.randomPrivateKey().slice(0, 16));
  if (!NONCE_RE.test(nonce)) throw new TypeError('invalid nonce');
  const issuedAt = iso(p.issuedAt ?? new Date(), 'issuedAt');
  const ttl = p.ttlMs ?? DEFAULT_TTL;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL) throw new TypeError('invalid ttlMs');
  const expirationTime = iso(p.expirationTime ?? new Date(Date.parse(issuedAt) + ttl), 'expirationTime');
  const life = Date.parse(expirationTime) - Date.parse(issuedAt);
  if (life <= 0 || life > MAX_TTL) throw new TypeError('invalid expirationTime');
  const statement = clean(p.statement, 'statement');
  const uri = clean(p.uri, 'uri');
  const chainId = clean(p.chainId, 'chainId');
  const lines = [p.domain + HEADER, p.address];
  if (statement !== undefined) lines.push('', statement);
  lines.push('');
  if (uri !== undefined) lines.push(`URI: ${uri}`);
  lines.push('Version: 1');
  if (chainId !== undefined) lines.push(`Chain ID: ${chainId}`);
  lines.push(`Nonce: ${nonce}`, `Issued At: ${issuedAt}`, `Expiration Time: ${expirationTime}`);
  return lines.join('\n');
}

/** Parses a message made by createMessage. Returns null when it is not canonical. */
export function parseMessage(message: string): SiwsFields | null {
  if (typeof message !== 'string' || message.length > 4096) return null;
  const lines = message.split('\n');
  const head = lines[0] ?? '';
  if (!head.endsWith(HEADER)) return null;
  const domain = head.slice(0, -HEADER.length);
  const address = lines[1] ?? '';
  let i = 2;
  let statement: string | undefined;
  if (lines[i] !== '') return null;
  i++;
  if (lines[i] !== undefined && !/^(URI|Version): /.test(lines[i])) {
    statement = lines[i];
    i++;
    if (lines[i] !== '') return null;
    i++;
  }
  const take = (key: string, optional: boolean): string | undefined | null => {
    const l = lines[i];
    if (l !== undefined && l.startsWith(key + ': ')) { i++; return l.slice(key.length + 2); }
    return optional ? undefined : null;
  };
  const uri = take('URI', true);
  if (take('Version', false) !== '1') return null;
  const chainId = take('Chain ID', true);
  const nonce = take('Nonce', false);
  const issuedAt = take('Issued At', false);
  const expirationTime = take('Expiration Time', false);
  if (i !== lines.length || nonce == null || issuedAt == null || expirationTime == null) return null;
  const f: SiwsFields = { domain, address, nonce, issuedAt, expirationTime };
  if (statement !== undefined) f.statement = statement;
  if (uri != null) f.uri = uri;
  if (chainId != null) f.chainId = chainId;
  // canonical round trip: rejects odd spacing, bad dates, bad domain, bad address
  try {
    if (!ISO_RE.test(issuedAt) || !ISO_RE.test(expirationTime)) return null;
    if (createMessage(f) !== message) return null;
  } catch {
    return null;
  }
  return f;
}

function sigBytes(s: Uint8Array | string): Uint8Array | null {
  try {
    const b = typeof s === 'string' ? base58.decode(s) : s;
    return b instanceof Uint8Array && b.length === 64 ? b : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a signed message. Order: shape, domain, time, replay, allowlist, signature.
 * The nonce is spent only after the signature is valid, so a stranger cannot burn a user's nonce.
 */
export function verify(p: VerifyParams): VerifyResult {
  const fields = parseMessage(p.message);
  if (!fields) return { ok: false, reason: 'malformed_message' };
  const sig = sigBytes(p.signature);
  if (!sig) return { ok: false, reason: 'malformed_signature' };
  if (!isAddress(p.address)) return { ok: false, reason: 'malformed_address' };
  if (fields.address !== p.address) return { ok: false, reason: 'address_mismatch' };
  if (p.domain !== undefined && fields.domain !== p.domain) return { ok: false, reason: 'wrong_domain' };
  const now = (p.now ?? new Date()).getTime();
  const skew = p.skewMs ?? 60_000;
  if (Date.parse(fields.issuedAt) - skew > now) return { ok: false, reason: 'not_yet_valid' };
  if (Date.parse(fields.expirationTime) <= now) return { ok: false, reason: 'expired' };
  if (p.seen?.has(fields.nonce)) return { ok: false, reason: 'replayed_nonce' };
  const allowed = new Set(p.allowlist);
  if (!allowed.has(p.address)) return { ok: false, reason: 'not_on_allowlist' };
  let good = false;
  try {
    good = ed25519.verify(sig, new TextEncoder().encode(p.message), base58.decode(p.address));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'bad_signature' };
  p.seen?.add(fields.nonce);
  return { ok: true, reason: 'ok', fields };
}
