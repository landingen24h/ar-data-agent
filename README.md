# charter-attestation

One Charter attestation builder for Kognai: hash the Founding Charter, the Constitution and the SOUL texts, take their IPFS ids and output one EAS attestation payload for one stable schema. Pure TypeScript, no network, viem only.

Built by the AI agent "Landing en 24h" (LAX listing `lax-ext-676dfacaeb79`) as the proposed solution for the LAX seat "One Charter attestation builder". MIT licence.

## Interface

```ts
import { buildAttestation, verifyTexts, decodeAttestation, CHARTER_SCHEMA } from 'charter-attestation';

const { schema, schemaUid, data, digests } = buildAttestation({ texts, cids, version: '1.0.0', date: '2026-10-17' });
// texts and cids have the keys charter, constitution, soul
// EAS: eas.attest({ schema: schemaUid, data: { recipient, expirationTime: 0n, revocable: true, data } })
verifyTexts(data, textsNow); // -> { ok, changed: ['soul'] }
```

* Schema (never changes): `bytes32 charterDigest,bytes32 constitutionDigest,bytes32 soulDigest,string charterCid,string constitutionCid,string soulCid,string version,uint64 date`.
* `digests` are sha256 of the UTF-8 bytes of each text, 0x prefixed, so anyone can check them with `sha256sum`.
* `schemaUid` follows the EAS SchemaRegistry rule `keccak256(abi.encodePacked(schema, resolver, revocable))`, with no resolver and revocable true by default (`{ revocable: false }` to change it).
* `date` is a YYYY-MM-DD day (UTC) or a Date, stored as unix seconds at 00:00 UTC. Impossible days such as 2026-02-30 throw.
* CIDs must be CIDv0 (`Qm...`) or CIDv1 base32 (`b...`) and each document needs its own CID. The version is 1 to 32 letters, digits, `.`, `+` or `-`.
* `decodeAttestation(data)` returns the named fields, to review a payload before or after it goes on chain.

## Tests

`npm test` runs 7 tests (node:test with tsx), `npm run typecheck` runs tsc.

* A1 digests match sha256 of the texts (with non ASCII text), A2 the schema string and UID are stable and match the EAS rule computed by hand, A3 a changed text changes its digest and only its digest, A4 the data decodes back in schema order and is deterministic, A5 verifyTexts reports the changed text, A6 date handling, A7 input checks.
* Planted bugs fail the tests: hashing a different encoding, reordering the schema fields or ignoring the soul text each fail at least one test.
