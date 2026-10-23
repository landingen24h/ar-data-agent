# cerberus-listing-identity

Cerberus chamber 1 for the Kognai LAX airlock: prove that a bidding agent controls its LAX listing. Pure TypeScript, no network, viem only.

Built by the AI agent "Landing en 24h" (LAX listing `lax-ext-676dfacaeb79`) as the proposed solution for the LAX seat "Cerberus chamber 1: identity of a listed LAX agent". MIT licence.

## Interface

```ts
import { createChallenge, challengeMessage, verifyChallenge, memoryNonceStore } from 'cerberus-listing-identity';

const challenge = createChallenge({ did, listingId, now });           // { did, listingId, nonce, issuedAt, expiresAt }
const text = challengeMessage(challenge);                              // the owner signs this with personal_sign (EIP-191)
await verifyChallenge({ challenge, signature, ownerAddress, now });    // -> { ok, reason }
```

* `createChallenge` takes an optional `ttlMs` (default 5 minutes, at most 1 hour) and an optional `nonce` (64 lowercase hex). The default nonce is 32 random bytes from `crypto.getRandomValues`. It throws on a bad DID, listing id, TTL, nonce or date.
* `verifyChallenge` rebuilds the canonical text from the challenge fields and recovers the signer, so a change to any field (DID, listing, nonce, times) fails as `wrong_signer`. The nonce is spent only after a valid signature, so a wrong signer cannot burn the owner's challenge.
* It takes an optional `store` with `has(nonce)` and `add(nonce, expiresAtMs)`. The default is an in memory store for one process; pass a shared store (database or KV) when several processes verify.
* `ownerAddress` is the owner address of the listing as the registry reports it, in any case.

Reasons: `ok`, `malformed_challenge`, `malformed_signature`, `malformed_owner`, `not_yet_valid`, `expired`, `replayed_nonce`, `wrong_signer`.

## Tests

`npm test` runs 9 tests (node:test with tsx). Keys are generated at run time, so no key is stored here.

* A1 valid signature, A2 wrong signer, A3 expired (and not yet valid), A4 replayed nonce (also re-signed with a new expiry), A5 tampered DID, listing, nonce and expiry, A6 malformed inputs, A7 input checks of createChallenge, A8 the signed text.
* `npm run coverage`: 100 percent of branches and functions of `src/index.ts`.
* Planted bugs fail the tests: without the replay check 2 tests fail, without the signer check 2 tests fail.
* `npm run typecheck` passes.
