# ar-data-agent × NEAR Intents (branch `near-hackathon`)

Work on this branch started 2026-10-31 for the NEAR Hackathon (tracks `agents` / `business`).
`main` is the existing Celo x402 product; everything NEAR-specific lives here.

## Problem
ar-data-agent sells Argentine data (official/blue dollar, INDEC CPI, holidays, CUIT/CBU checks)
for ~0.01 USD per call via x402 on Celo. Callers whose funds sit on Base, Solana, Arbitrum or
NEAR cannot pay it without bridging first, and bridges have minimums (1Click quoted a floor of
0.144446 USDC from Base on 2026-10-31), so per-call cross-chain micropayments do not work.

## Design: call-credit packs paid through NEAR Intents
1. Caller asks for a pack of N calls and names the token it holds (any 1Click `assetId`).
2. The agent requests an **EXACT_OUTPUT** 1Click quote: N × 0.01 USDC delivered to the agent's
   NEAR account, never below the bridge floor. The payer covers bridge fees on the origin side;
   refunds go back to the payer's origin address.
3. Caller sends `amountIn` to the quote's deposit address from its own chain.
4. Agent polls `/v0/status`; on `SUCCESS` it mints a bearer credit token
   (`arc_…`, one redemption per deposit address, only for quotes it issued to itself).
5. Paid routes accept `Authorization: Bearer arc_…` and decrement one credit per call.

The agent only *receives* on NEAR, so this rail needs no NEAR signing key at all.

## Status
- [x] `src/near.js`: quote builder, 1Click client, status polling, bridge-floor handling, credit ledger
- [x] `test/near.test.js`: 7 tests (replay, foreign quote, unsettled swap, token format)
- [x] `scripts/near-quote.js`: live dry quote against mainnet 1Click (read-only)
- [ ] Agent NEAR account (to be created by the team) and wiring into `/ar/*` routes
- [ ] Durable Object store for the ledger on Workers
- [ ] End-to-end demo: Base USDC → NEAR USDC → credits → paid `/ar/dolar` call

## Try it (read-only)
```
node scripts/near-quote.js 20            # 20 calls paid from Base USDC
node scripts/near-quote.js 5             # below the bridge floor: retries at the floor
```
