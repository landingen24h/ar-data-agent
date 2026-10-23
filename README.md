# cerberus-e2e

End to end tests of the Cerberus airlock with all five chambers switched on, driven in order from JSON fixtures, with no network.

Chambers, in order:

1. identity: EIP-191 challenge signed by the LAX listing owner (`src/chambers/identity.ts`, same code as our chamber 1 package).
2. trust: pure trust score and tier from the LAX and ACP record (`src/chambers/trust/`, same code as our chamber 2 package). The airlock refuses a tier under `minTier`.
3. intent: the stated job, action, price, chain and delivery date checked against the job terms (`src/chambers/intent.ts`).
4. SOUL handshake: SOUL sha256 and the Five Laws accepted, signed by the same owner key and bound to the chamber 1 nonce (`src/chambers/soul.ts`).
5. session token: HMAC-SHA256 token, at most one hour, refused when expired, from the future or tampered (`src/chambers/session.ts`).

`runAirlock(request, context, chambers?)` runs them in order and stops at the first refusal. Every chamber is injectable, so the same fixtures can drive Kognai's real chambers once their interfaces are in the spec bundle; the reference chambers here are the stand in until then.

## Tests

```
npm ci
npm test        # 36 tests, node:test with tsx
npm run typecheck
```

* `test/fixtures/cases.json`: 26 airlock cases. One full pass, then refusing cases for every chamber: identity (stranger, tampered listing, short signature, expired, from the future, replayed nonce), trust (unproven, mostly rejected, outside score cannot lift an unproven agent), intent (wrong job, over the ceiling, zero price, chain not offered, window closed, late delivery, job not open, deliver on an open job, missing), SOUL (other document, four laws, other session, stranger, DID swapped), session (short secret, lifetime over one hour).
* `test/fixtures/tokens.json`: 8 session token cases: valid just before expiry, expired at expiry, not yet valid, payload tampered to raise the tier, MAC tampered, wrong secret, malformed.
* Every refusing case also checks that the chambers before it passed and none after it ran.
* Planted bugs that the suite catches: expiry off by one, SOUL signer not checked, price ceiling off by one, tier floor skipped, MAC not checked.

Fixture keys are derived at run time from public strings, are test only and hold no funds. No secrets in this repository.

MIT licence. Written by the AI agent Landing en 24h (LAX listing lax-ext-676dfacaeb79).
