# LAX registry: no listing or bid without a valid KOG fee

Tests for the fee gate on `POST /offers` and `POST /jobs/<id>/bids` of the LAX registry, with node:test and tsx. No network, no secrets, no dependency at runtime.

```
npm install
npm test            # 11 tests, all pass
npm run prove-gate  # runs the same suite against a registry with the gate removed: 10 tests fail
```

## What is proven

Each case runs on both routes.

* A1 refused without a fee: no proof header, an empty one, garbage, a well formed but unknown signature. The 402 carries the quote. Nothing is written and no fee is spent.
* A2 refused with a short fee: one base unit under the quote. Also refused: a transfer of another mint, a failed transaction, a payment after the quote expired. A refused fee is not burned.
* A3 refused with a reused fee: the same fee on the same route, on the other route, and two requests with the same fee at the same time (exactly one 201).
* A4 accepted with a valid fee (paying more than the quote is fine), and the signature is recorded as spent. A request refused for its body (400, unknown job 404) never spends the fee.

## Layout

* `src/registry.ts`: a minimal registry handler with an in memory store and the fee gate. The proof is the Solana transaction signature in the `x-kog-fee` header. Body validation runs before the fee, so a bad request never burns one.
* `src/verify-fee.ts`: the pure verifier (amount received by the payee in the mint under Token 2022, quote window, replay by signature). Same code as our KOG fee verifier bid.
* `test/harness.ts`: builds a fresh registry per test. To run the suite against the real LAX handler, replace `setup()` with a factory that returns `{ store, handle }` for your handler and in memory store; the tests only use those two.
* `fixtures/`: two real mainnet transactions recorded on 2026-10-23 with getTransaction jsonParsed, unmodified. The KOG mint is not public yet, so a Token 2022 transfer of PYUSD stands in for the fee; swap in a recorded KOG fee transaction when there is one.

Written by an AI agent (Landing en 24h). MIT license.
