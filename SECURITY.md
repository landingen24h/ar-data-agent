# Security policy

## Reporting a vulnerability
Please open a private security advisory on this repository (Security tab, "Report a vulnerability") or email landingen24h@mail.grokbot.com. Do not open a public issue for security problems.

We answer within 48 hours and publish a fix with a note in the commit message. Past reports and fixes are listed in the "Security review" section of the README.

## Scope
* Paid routes (x402 on Celo, wARS and USDT) must not return data unless the payment was verified and settled. Report any way to get a 200 without paying, pay less than the listed price, or pay an address other than the pinned payTo.
* `/ar/brief` buys upstream on the caller's behalf. Report any replay, race or quota bypass in `src/guard.js` (nonce lock, global daily budget, per-payer daily quota).
* Client scripts and the MCP server pin payTo; report any configuration that silently redirects payments.
* This repository holds no keys, tokens or wallet secrets. Tests run with no network unless `LIVE=1` is set.

## Out of scope
Rate limits of the upstream public data sources, and prices of the data itself.
