/**
 * Cerberus chamber 4: SOUL handshake. The agent accepts the house rules (the SOUL
 * document, by its sha256, and each of the Five Laws) and signs that acceptance with
 * the same owner key as chamber 1, bound to the chamber 1 nonce so it cannot be
 * replayed into another session. No network.
 */
import { getAddress, isHex, recoverMessageAddress, type Hex } from 'viem';

export const LAWS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;

export interface Handshake {
  did: string;
  soul_sha256: string;
  laws_accepted: string[];
  nonce: string;
  signature: string;
}

export type SoulReason = 'ok' | 'malformed_handshake' | 'soul_mismatch' | 'laws_incomplete' | 'nonce_mismatch' | 'malformed_signature' | 'wrong_signer';

export function handshakeMessage(h: Pick<Handshake, 'did' | 'soul_sha256' | 'laws_accepted' | 'nonce'>): string {
  return ['Kognai SOUL handshake', `DID: ${h.did}`, `SOUL sha256: ${h.soul_sha256}`, `Laws accepted: ${h.laws_accepted.join(',')}`, `Session nonce: ${h.nonce}`].join('\n');
}

export async function verifyHandshake(input: {
  handshake: unknown;
  expectedSoul: string;
  expectedDid: string;
  sessionNonce: string;
  ownerAddress: string;
}): Promise<{ ok: boolean; reason: SoulReason }> {
  const h = input.handshake as Handshake;
  if (
    !h || typeof h !== 'object' || typeof h.did !== 'string' || typeof h.soul_sha256 !== 'string' ||
    !Array.isArray(h.laws_accepted) || typeof h.nonce !== 'string' || typeof h.signature !== 'string' || h.did !== input.expectedDid
  ) return { ok: false, reason: 'malformed_handshake' };
  if (h.soul_sha256 !== input.expectedSoul) return { ok: false, reason: 'soul_mismatch' };
  if (h.laws_accepted.length !== LAWS.length || !LAWS.every((l, i) => h.laws_accepted[i] === l)) return { ok: false, reason: 'laws_incomplete' };
  if (h.nonce !== input.sessionNonce) return { ok: false, reason: 'nonce_mismatch' };
  if (!isHex(h.signature) || h.signature.length !== 132) return { ok: false, reason: 'malformed_signature' };
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: handshakeMessage(h), signature: h.signature as Hex });
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  if (getAddress(signer) !== getAddress(input.ownerAddress)) return { ok: false, reason: 'wrong_signer' };
  return { ok: true, reason: 'ok' };
}
