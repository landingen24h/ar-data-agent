// did:key for ed25519, made locally with node:crypto. No network.
import { generateKeyPairSync, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PUB = [0xed, 0x01]; // multicodec varint for ed25519-pub

/** @param {Uint8Array} bytes */
export function base58btc(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  return '1'.repeat(zeros) + out;
}

/** @param {string} s */
export function base58btcDecode(s) {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('invalid base58 character');
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

/** @param {Uint8Array} raw 32 byte ed25519 public key */
export function didFromPublicKey(raw) {
  if (raw.length !== 32) throw new Error('ed25519 public key must be 32 bytes');
  return 'did:key:z' + base58btc(Uint8Array.from([...ED25519_PUB, ...raw]));
}

/** @param {string} did */
export function publicKeyFromDid(did) {
  if (!did.startsWith('did:key:z')) throw new Error('not a base58btc did:key');
  const b = base58btcDecode(did.slice('did:key:z'.length));
  if (b[0] !== ED25519_PUB[0] || b[1] !== ED25519_PUB[1] || b.length !== 34) throw new Error('not an ed25519 did:key');
  return b.slice(2);
}

/** Creates a fresh keypair. Returns the did, the raw public key and the private key as PKCS8 PEM. */
export function generateIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return {
    did: didFromPublicKey(raw),
    publicKey: new Uint8Array(raw),
    privateKeyPem: /** @type {string} */ (privateKey.export({ format: 'pem', type: 'pkcs8' })),
  };
}

/** Signs bytes with a PKCS8 PEM ed25519 key. */
export function signWith(privateKeyPem, data) {
  return sign(null, Buffer.from(data), createPrivateKey(privateKeyPem));
}

/** Verifies a signature against a did:key. */
export function verifyWithDid(did, data, signature) {
  const x = Buffer.from(publicKeyFromDid(did)).toString('base64url');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
  return verify(null, Buffer.from(data), key, signature);
}
