import { createHash } from 'node:crypto';
import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters, keccak256, encodePacked, zeroAddress, type Hex } from 'viem';

/** The one EAS schema for the Charter attestation. Never change it: the schema UID depends on this exact text. */
export const CHARTER_SCHEMA =
  'bytes32 charterDigest,bytes32 constitutionDigest,bytes32 soulDigest,string charterCid,string constitutionCid,string soulCid,string version,uint64 date';

const PARAMS = parseAbiParameters(CHARTER_SCHEMA);

export type DocName = 'charter' | 'constitution' | 'soul';
export const DOCS: readonly DocName[] = ['charter', 'constitution', 'soul'];

export interface BuildInput {
  texts: Record<DocName, string>;
  cids: Record<DocName, string>;
  version: string;
  /** Day of the Charter, as YYYY-MM-DD (UTC) or a Date. Stored as unix seconds at 00:00 UTC. */
  date: string | Date;
}

export interface Attestation {
  /** The EAS schema string, stable across calls. */
  schema: string;
  /** EAS schema UID for this schema with no resolver, revocable as given (default true). */
  schemaUid: Hex;
  /** ABI encoded attestation data for the schema, ready for EAS attest({ schema: schemaUid, data: { data } }). */
  data: Hex;
  /** sha256 of the UTF-8 bytes of each text, 0x prefixed. */
  digests: Record<DocName, Hex>;
  /** The decoded values in schema order, for review. */
  values: { version: string; date: bigint; cids: Record<DocName, string> };
}

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_B32 = /^b[a-z2-7]{50,}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function sha256Hex(text: string): Hex {
  return ('0x' + createHash('sha256').update(text, 'utf8').digest('hex')) as Hex;
}

export function isCid(cid: string): boolean {
  return CID_V0.test(cid) || CID_V1_B32.test(cid);
}

/** EAS SchemaRegistry UID: keccak256(abi.encodePacked(schema, resolver, revocable)). */
export function schemaUid(schema = CHARTER_SCHEMA, resolver: Hex = zeroAddress, revocable = true): Hex {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]));
}

export function toUnixDay(date: string | Date): bigint {
  let ms: number;
  if (date instanceof Date) {
    ms = date.getTime();
    if (!Number.isFinite(ms)) throw new Error('date: invalid Date');
    ms = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  } else {
    const m = typeof date === 'string' ? DAY.exec(date) : null;
    if (!m) throw new Error('date: expected YYYY-MM-DD');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error('date: not a real day');
  }
  if (ms < 0) throw new Error('date: before 1970');
  return BigInt(ms / 1000);
}

export function buildAttestation(input: BuildInput, opts: { revocable?: boolean } = {}): Attestation {
  if (!input || typeof input !== 'object') throw new Error('input: expected an object');
  const { texts, cids, version, date } = input;
  if (!texts || !cids) throw new Error('input: texts and cids are required');
  const digests = {} as Record<DocName, Hex>;
  for (const k of DOCS) {
    const t = texts[k];
    if (typeof t !== 'string' || t.trim() === '') throw new Error(`texts.${k}: expected a non empty string`);
    if (typeof cids[k] !== 'string' || !isCid(cids[k])) throw new Error(`cids.${k}: expected an IPFS CID (v0 Qm... or v1 base32 b...)`);
    digests[k] = sha256Hex(t);
  }
  const all = DOCS.map((k) => cids[k]);
  if (new Set(all).size !== all.length) throw new Error('cids: each document needs its own CID');
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('version: expected 1 to 32 chars of letters, digits, . + -');
  const day = toUnixDay(date);
  const data = encodeAbiParameters(PARAMS, [digests.charter, digests.constitution, digests.soul, cids.charter, cids.constitution, cids.soul, version, day]);
  return {
    schema: CHARTER_SCHEMA,
    schemaUid: schemaUid(CHARTER_SCHEMA, zeroAddress, opts.revocable ?? true),
    data,
    digests,
    values: { version, date: day, cids: { charter: cids.charter, constitution: cids.constitution, soul: cids.soul } },
  };
}

/** Decode attestation data back to named fields, to check a payload before or after it goes on chain. */
export function decodeAttestation(data: Hex) {
  const [charterDigest, constitutionDigest, soulDigest, charterCid, constitutionCid, soulCid, version, date] = decodeAbiParameters(PARAMS, data);
  return { charterDigest, constitutionDigest, soulDigest, charterCid, constitutionCid, soulCid, version, date };
}

/** True when the texts given now still match the digests inside an attestation payload. */
export function verifyTexts(data: Hex, texts: Record<DocName, string>): { ok: boolean; changed: DocName[] } {
  const d = decodeAttestation(data);
  const onChain: Record<DocName, string> = { charter: d.charterDigest, constitution: d.constitutionDigest, soul: d.soulDigest };
  const changed = DOCS.filter((k) => typeof texts?.[k] !== 'string' || sha256Hex(texts[k]).toLowerCase() !== onChain[k].toLowerCase());
  return { ok: changed.length === 0, changed };
}
