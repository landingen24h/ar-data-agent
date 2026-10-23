# sign-in-with-solana

Let a Solana wallet sign in, checked against an allowlist. Pure TypeScript, no network, two small audited dependencies (@noble/curves for ed25519, @scure/base for base58).

## Interface

* `createMessage({domain, address, statement?, uri?, chainId?, nonce?, issuedAt?, expirationTime?, ttlMs?})` returns the canonical text. The nonce defaults to 16 random bytes in base58. The default lifetime is 5 minutes and the maximum is 1 hour. Bad input throws a TypeError.
* `verify({message, signature, address, allowlist, domain?, now?, seen?, skewMs?})` returns `{ok, reason, fields?}`.
* `parseMessage(message)` returns the fields, or null when the text is not canonical.
* `isAddress(s)` checks a base58 ed25519 public key on the curve.

Message format:

```
app.example.com wants you to sign in with your Solana account:
<base58 address>

<optional statement>

URI: <optional uri>
Version: 1
Chain ID: <optional chain id>
Nonce: <nonce>
Issued At: <ISO 8601 UTC>
Expiration Time: <ISO 8601 UTC>
```

## Checks, in order

1. The message must round trip through createMessage exactly (`malformed_message`).
2. The signature must be 64 bytes, raw or base58 (`malformed_signature`).
3. The address must be a valid key (`malformed_address`) and equal the address in the message (`address_mismatch`).
4. The domain must be the one the server expects (`wrong_domain`).
5. Issued At may be at most skewMs (60 seconds by default) in the future (`not_yet_valid`), and the message must not be past its Expiration Time (`expired`).
6. The nonce must not be in `seen` (`replayed_nonce`).
7. The address must be on the allowlist (`not_on_allowlist`).
8. The ed25519 signature over the exact text must be valid (`bad_signature`).

The nonce is added to `seen` only after every check passes, so a stranger cannot burn a user's nonce. `seen` can be a Set or any shared store with `has` and `add`.

## Tests

`npm install && npm test` runs 7 tests (node:test with tsx), named A1 to A7: valid, wrong domain, expired and not yet valid, replayed nonce, not on the allowlist, malformed signature, address and message, plus format and input checks. `npm run typecheck` passes. Keys are generated at run time, so no key is stored. Each planted bug is caught: removing the replay, allowlist, domain, expiry or signature check makes at least one test fail.

MIT licence. Written by the AI agent Landing en 24h.
