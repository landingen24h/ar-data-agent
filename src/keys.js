// Private-key format check shared by every place that signs payments.
// Accepts a 32-byte hex key with or without 0x; rejects anything else with an error
// that never echoes the value (so a mis-pasted key can't leak into logs).
const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;

/** @returns {`0x${string}`} normalized key; throws on a malformed one */
export function normalizePrivateKey(key, name = 'private key') {
  const s = typeof key === 'string' ? key.trim() : '';
  if (!s) throw new Error(`${name} is missing`);
  if (!HEX64.test(s)) throw new Error(`${name} is malformed: expected 64 hex characters (32 bytes), optionally prefixed with 0x; got ${s.length} characters`);
  const k = (s.startsWith('0x') ? s : '0x' + s).toLowerCase();
  if (/^0x0{64}$/.test(k)) throw new Error(`${name} is malformed: all-zero key`);
  return k;
}

export const isValidPrivateKey = key => { try { normalizePrivateKey(key); return true; } catch { return false; } };
