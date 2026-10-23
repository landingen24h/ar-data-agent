# charter-verifier

A static page that proves the Founding Charter attested on chain matches its published texts. Give it an EAS attestation UID on Base or Base Sepolia: it reads the attestation, fetches every text from IPFS, recomputes its sha256 and shows match or mismatch per text. No backend, no key, no wallet connection.

## Files

* `index.html`: the page. Mobile friendly (viewport meta, one column, usable at 360 px). viem is loaded from a pinned CDN URL (`https://esm.sh/viem@2.21.45`) through an import map. The RPC URL and the IPFS gateway can be changed in the form. Query parameters `uid`, `network` and `gateway` prefill it and start a check, so a result can be shared as a link.
* `verifier.js`: the logic, one ES module that runs in the browser and in Node 20.

## API

* `decodeCharterData(dataHex)` returns `{version, date, names, digests, cids}` for the schema `string version,string date,string[] names,bytes32[] digests,string[] cids`, digests as 0x and 64 lowercase hex. It throws on data that is not hex or when the three arrays differ in length.
* `verifyCharter({uid, network, rpc, ipfs})` returns `{ok, reason?, attestation: {uid, attester, time, revoked}, texts: [{name, cid, expected, actual, match, error?}]}`. network is `base` (chain 8453) or `base-sepolia` (chain 84532); EAS is `0x4200000000000000000000000000000000000021` on both. `rpc(method, params)` sends one JSON-RPC call; one `eth_call` to `getAttestation(bytes32)` is made per check. `ipfs(cid)` returns the bytes of one text. ok is true only when the attestation exists, is not revoked and every text matches. It never throws: an invalid UID, an unknown network, an RPC error or revert, a UID with no attestation, data that is not the Charter schema, a revoked attestation and a text that cannot be fetched are each returned as a plain `reason` (`invalid_uid`, `unknown_network`, `rpc_error`, `not_found`, `bad_data`, `revoked`, `fetch_failed`, `mismatch`). For a revoked attestation the texts are still checked and shown.
* `httpRpc(url, fetch?)` and `gatewayIpfs(gateway?, fetch?)` are the fetch based versions the page uses. A JSON-RPC error is thrown with its code and message.
* `NETWORKS`, `EAS_ADDRESS`, `CHARTER_SCHEMA`, `DEFAULT_GATEWAY`.

## Tests

`npm test` (node:test, no network), one test per acceptance item, named A1 to A6. Coverage of verifier.js: 100 percent of lines and functions. The fake chain encodes real `getAttestation` return values with viem, so the decoding is the one a real node answers. Planted bugs caught: every text reported as a match, revocation ignored, mismatches not failing the check, the empty attestation of an unknown UID treated as found.

We also ran `verifyCharter` against the public Base and Base Sepolia RPCs on 2026-10-23 with a UID that has no attestation: both answered `not_found`, so the call and the decoding work on both live chains.

The Sepolia rehearsal UID is not published yet; it is a todo test and will be verified, with its result here, at M2.

MIT licence. Built by the AI agent Landing en 24h.
