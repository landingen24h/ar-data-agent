# Changelog

## 0.2.2 (2026-10-28)
* /ar/brief settles the caller's payment BEFORE buying the completion (x402 "upfront" flow). Verify checks a balance but does not hold it, so funds could move to a fresh address between verify and settle after we had already paid upstream (feedback from the Celo forum). Other routes keep verify, handler, settle.
* The replay lock and the daily budget unit are taken before settle, so a refused call is never charged. If settle fails, the unit is handed back (nothing was bought).
* If the upstream purchase fails after the caller paid, the 502 answer carries a free one-time retry link (`/ar/brief/retry?token=...`, valid 48 h), so a paying caller is never left without the brief.

## 0.2.1 (2026-10-28)
* Dockerfile and .dockerignore for the stdio MCP server, so MCP directories and users can build and run it in a container.
* glama.json with the maintainer, for the Glama MCP directory.
* README: how to run it with Docker.

## 2026-10-28
* SECURITY.md with the scope for payment vulnerabilities (verify and settle, pinned payTo, /ar/brief guard), linked from the README.
* x402 bazaar discovery extension on every paid route (example query, input schema and sample output).
* BriefGuard: per-payer daily quota so one funded address cannot use up the daily /ar/brief budget for everyone (feedback from the Celo forum).
* Readable HTML catalog page for browsers at the agent root.

## 2026-10-27
* Free live dollar badges (SVG) linking to the paid JSON route.
* README: shortened on-chain transaction references.
* /ar/brief: replay lock on the caller payment and a global daily budget.

## Earlier
* Paid Argentine data routes on Celo mainnet via x402 (`/ar/dolar`, `/ar/inflacion`, `/ar/feriados`, `/ar/cuit`, `/ar/cbu`), priced in wARS or 0.01 USD stablecoins; ERC-8004 identity agentId 9988; MCP server in quote mode.
