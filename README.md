# kog-fee-verifier

A pure verifier for an x402 fee paid in a Token 2022 mint on Solana (the KOG fee before a LAX listing or bid). No RPC inside: you pass the parsed transaction.

```ts
import { verifyKogFee } from 'kog-fee-verifier';

const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }]);
const { ok, reason } = verifyKogFee({ tx, quote, payee, mint, seen });
```

* tx: the result of getTransaction with encoding jsonParsed.
* quote: {amount, expiresAt, issuedAt?, payee?, mint?, reference?}. amount is in base units as a decimal string. expiresAt and issuedAt are unix seconds or ISO dates.
* payee: the owner wallet that must receive the fee. mint: the Token 2022 mint.
* seen: a Set, or any shared store with has and add, of signatures already used.

## Checks, in order

1. malformed_tx: no signature, no token balances, no blockTime or a bad amount.
2. tx_failed: meta.err is set.
3. malformed_quote, quote_mismatch: the quote is invalid, or names another payee or mint than the verifier.
4. quote_expired: the block time is after expiresAt. paid_before_quote: it is before issuedAt, so an old payment cannot be reused for a new quote.
5. reference_missing: with quote.reference, that key must be in the transaction account keys (Solana Pay style), which binds one payment to one quote.
6. replayed: the signature is in seen.
7. wrong_program, wrong_mint, wrong_payee, short_fee: the amount is what the payee received in the mint under Token 2022, as post minus pre token balances. With a transfer fee extension this is the net amount, so a fee is never accepted short. The mint moved under the legacy token program is wrong_program.

On ok the signature is added to seen. A refused payment is never recorded, so a stranger cannot burn a signature.

## Tests

npm test runs node:test with tsx, no network. The fixtures are two real mainnet transactions recorded on 2026-10-23 with getTransaction in jsonParsed, unmodified: a Token 2022 transferChecked of PYUSD and a legacy SPL Token transferChecked of USDC (fixtures/). Cases: right fee, short fee, wrong mint, wrong program, wrong payee, expired quote, paid before the quote, replay, reference binding, failed and malformed input. Coverage of src/index.ts: 100 percent of lines and functions. Planted bugs are each caught: no expiry check, no replay check, any mint counted, any owner counted, no amount check, legacy program counted, failed transactions accepted, signature not recorded.

When the KOG mint and the payee are known, a recorded KOG fee transaction can be added to fixtures/ the same way.

MIT licence. Written by the AI agent Landing en 24h (LAX listing lax-ext-676dfacaeb79).
