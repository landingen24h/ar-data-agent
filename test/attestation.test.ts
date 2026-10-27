import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { keccak256, toHex, concat, zeroAddress } from 'viem';
import { buildAttestation, decodeAttestation, verifyTexts, schemaUid, toUnixDay, isCid, CHARTER_SCHEMA, sha256Hex } from '../src/index.ts';

const texts = { charter: 'Founding Charter of Kognai.\nArticle 1.', constitution: 'Constitution text, version 1.', soul: 'SOUL: be honest, be useful. ñ é 漢字' };
const cids = {
  charter: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
  constitution: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  soul: 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o',
};
const input = { texts, cids, version: '1.0.0', date: '2026-10-17' };
const sha = (t: string) => '0x' + createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');

test('A1 digests match sha256 of the given texts (UTF-8)', () => {
  const a = buildAttestation(input);
  assert.equal(a.digests.charter, sha(texts.charter));
  assert.equal(a.digests.constitution, sha(texts.constitution));
  assert.equal(a.digests.soul, sha(texts.soul));
  assert.equal(sha256Hex(''), '0xe3b0c44298fc1c149afbf4c8996fb924' + '27ae41e4649b934ca495991b7852b855');
});

test('A2 the schema string and its UID are stable', () => {
  const a = buildAttestation(input), b = buildAttestation({ ...input, version: '2.0.0', date: '2027-01-01' });
  assert.equal(a.schema, CHARTER_SCHEMA);
  assert.equal(b.schema, a.schema);
  assert.equal(a.schemaUid, b.schemaUid);
  assert.equal(CHARTER_SCHEMA, 'bytes32 charterDigest,bytes32 constitutionDigest,bytes32 soulDigest,string charterCid,string constitutionCid,string soulCid,string version,uint64 date');
  // EAS SchemaRegistry: keccak256(abi.encodePacked(schema, resolver, revocable))
  const manual = keccak256(concat([toHex(CHARTER_SCHEMA), zeroAddress, '0x01']));
  assert.equal(a.schemaUid, manual);
  assert.notEqual(schemaUid(CHARTER_SCHEMA, zeroAddress, false), manual);
  assert.equal(buildAttestation(input, { revocable: false }).schemaUid, schemaUid(CHARTER_SCHEMA, zeroAddress, false));
});

test('A3 a changed text changes its digest and only its digest', () => {
  const a = buildAttestation(input);
  for (const k of ['charter', 'constitution', 'soul'] as const) {
    const b = buildAttestation({ ...input, texts: { ...texts, [k]: texts[k] + ' ' } });
    assert.notEqual(b.digests[k], a.digests[k], k);
    assert.notEqual(b.data, a.data, k);
    for (const o of ['charter', 'constitution', 'soul'] as const) if (o !== k) assert.equal(b.digests[o], a.digests[o]);
  }
});

test('A4 the data decodes back to the inputs in schema order', () => {
  const a = buildAttestation(input);
  const d = decodeAttestation(a.data);
  assert.equal(d.charterDigest, a.digests.charter);
  assert.equal(d.constitutionDigest, a.digests.constitution);
  assert.equal(d.soulDigest, a.digests.soul);
  assert.equal(d.charterCid, cids.charter);
  assert.equal(d.constitutionCid, cids.constitution);
  assert.equal(d.soulCid, cids.soul);
  assert.equal(d.version, '1.0.0');
  assert.equal(d.date, 1792195200n);
  assert.deepEqual(a.values, { version: '1.0.0', date: 1792195200n, cids });
  assert.equal(buildAttestation(input).data, a.data, 'deterministic');
});

test('A5 verifyTexts finds which text changed', () => {
  const a = buildAttestation(input);
  assert.deepEqual(verifyTexts(a.data, texts), { ok: true, changed: [] });
  assert.deepEqual(verifyTexts(a.data, { ...texts, soul: 'other' }), { ok: false, changed: ['soul'] });
  assert.deepEqual(verifyTexts(a.data, { ...texts, charter: undefined as any }), { ok: false, changed: ['charter'] });
});

test('A6 dates: YYYY-MM-DD or Date, stored at 00:00 UTC', () => {
  assert.equal(toUnixDay('1970-01-01'), 0n);
  assert.equal(toUnixDay('2026-10-17'), 1792195200n);
  assert.equal(toUnixDay(new Date('2026-10-17T23:59:59Z')), 1792195200n);
  for (const bad of ['2026-02-30', '2026-13-01', '17/10/2026', '', 20261017 as any, new Date('nope')]) assert.throws(() => toUnixDay(bad), String(bad));
  assert.throws(() => toUnixDay(new Date('1969-12-31T00:00:00Z')), /before 1970/);
});

test('A7 input checks', () => {
  assert.ok(isCid(cids.charter) && isCid(cids.constitution));
  assert.ok(!isCid('Qm123') && !isCid('ipfs://' + cids.charter));
  assert.throws(() => buildAttestation(null as any), /input/);
  assert.throws(() => buildAttestation({ ...input, texts: undefined as any }), /required/);
  assert.throws(() => buildAttestation({ ...input, texts: { ...texts, soul: '  ' } }), /texts.soul/);
  assert.throws(() => buildAttestation({ ...input, cids: { ...cids, charter: 'nope' } }), /cids.charter/);
  assert.throws(() => buildAttestation({ ...input, cids: { ...cids, soul: cids.charter } }), /own CID/);
  assert.throws(() => buildAttestation({ ...input, version: '' }), /version/);
  assert.throws(() => buildAttestation({ ...input, version: 'v 1' }), /version/);
});
