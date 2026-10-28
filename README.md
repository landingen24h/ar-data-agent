# AR Data Agent: Argentine data, paid per call in pesos on Celo

A small, autonomous HTTP agent that sells Argentine public data and validations to
other agents and to people, **priced in wARS** (Ripio's Argentine peso stablecoin) and
settled on **Celo mainnet** through **x402** and Celo's hosted facilitator.

No sign-up, no API key, no card, no conversion through the dollar: the caller signs a
wARS payment for exactly the price of the call and gets the JSON back. The payer needs
**no CELO for gas**: the facilitator pays settlement gas and sponsors the Permit2
approval (EIP-2612), so a wallet holding only wARS can pay.

Built for the *Agents on Open Rails* hackathon, track **Stable Agents: LatAm (Ripio x Celo)**.

## At a glance

| | |
|---|---|
| Live endpoint (Celo mainnet) | <https://landingen24h.com/celo/> (catalog: `/celo/prices`) |
| ERC-8004 identity | **agentId 9988** on the Celo IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Registration file | <https://landingen24h.com/celo/.well-known/agent-registration.json> |
| PayTo / agent wallet | `0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1` (pinned in code, see Security) |
| Payment | x402 v2 on `eip155:42220` via `https://api.x402.celo.org`; wARS (Permit2, gas sponsored) or USDC / USD₮ / USA₮ (EIP-3009) |
| Attribution | ERC-8021 code `celo_85d42ed6ebcf` |
| Paid routes | `/ar/dolar`, `/ar/inflacion`, `/ar/feriados`, `/ar/cuit`, `/ar/cbu` (10 to 15 wARS, or 0.01 USD) |
| Pay in one line | `BUYER_PRIVATE_KEY=0x... node scripts/pay.js "https://landingen24h.com/celo/ar/dolar?casa=blue"` |
| MCP | `npx -y github:landingen24h/ar-data-agent` (quote mode without a key) |
| Tests | `npm test` (offline, mock facilitator) |
| Built and operated by | Landing en 24h, an AI agent business (code, deploys and this README are agent-written) |


## Free live badges

Show today's Argentine dollar in your README, docs or dashboard. Free, no key, cached 10 minutes, data from DolarApi.com:

[![dolar blue](https://landingen24h.com/badge/dolar-blue.svg)](https://github.com/landingen24h/ar-data-agent) [![dolar oficial](https://landingen24h.com/badge/dolar-oficial.svg)](https://github.com/landingen24h/ar-data-agent) [![dolar mep](https://landingen24h.com/badge/dolar-mep.svg)](https://github.com/landingen24h/ar-data-agent)

```markdown
[![dolar blue](https://landingen24h.com/badge/dolar-blue.svg)](https://github.com/landingen24h/ar-data-agent)
```

Types: `oficial`, `blue`, `mep`, `ccl`, `cripto`, `tarjeta`, `mayorista` (URL `https://landingen24h.com/badge/dolar-<type>.svg`). For the full JSON quotes with buy, sell, spread and the blue gap inside an agent, call `GET https://landingen24h.com/celo/ar/dolar` and pay per call in wARS over x402 on Celo.

## What it sells

| Route (GET) | Price | Alt. price | What you get |
|---|---|---|---|
| `/ar/dolar?casa=blue` | 15 wARS | 0.01 USDC / USD₮ / USA₮ | USD/ARS quotes: oficial, blue, MEP, CCL, cripto, tarjeta, mayorista, spread and blue-vs-oficial gap |
| `/ar/inflacion?from=2026-01&to=2026-09&amount=100000` | 15 wARS | 0.01 USDC / USD₮ / USA₮ | INDEC CPI: latest monthly and YoY, compounded inflation between months, amount adjuster |
| `/ar/feriados?date=2026-11-20&add_business_days=5` | 15 wARS | 0.01 USDC / USD₮ / USA₮ | National holidays, is-business-day, next business day, date + N business days |
| `/ar/cuit?cuit=20-12345678-6` | 10 wARS | 0.01 USDC / USD₮ / USA₮ | CUIT/CUIL check digit, entity type, formatting (offline) |
| `/ar/cbu?cbu=0070999003000412345671` | 10 wARS | 0.01 USDC / USD₮ / USA₮ | CBU/CVU check digits, CBU vs CVU, bank (offline) |

Free routes: `/` (machine-readable description and prices), `/prices`, `/health`,
`/ramp?address=0x...&amount=10000` (a Ripio on-ramp link that delivers wARS on Celo to
that address), `/.well-known/agent-registration.json` (ERC-8004 registration file).

**Fair charging rules**

- Input is validated *before* payment. A malformed request gets a free `400` and is never charged.
- If the upstream data source fails after the payment was verified, the handler returns
  `502` and the payment is **not settled** (the x402 middleware only settles responses below 400).

Data sources: DolarApi.com (quotes) and argentinadatos.com (INDEC CPI series and national
holidays). CUIT and CBU checks are offline checksum validations and do not query ARCA or banks.
Nothing here is financial advice.

## Why pesos

Argentine businesses, accountants and freelancers think, invoice and get paid in pesos.
An agent that needs today's MEP rate, an inflation adjustment for a contract, the
settlement date five business days from now, or to validate a CUIT/CBU before a transfer
should be able to pay for that in pesos too, in amounts too small for any card network.
wARS on Celo makes a 10-peso call economically possible; the Ripio ramp turns ARS in a
bank account into wARS on Celo with no extra step.

## How it works

```
client ── GET /ar/dolar ─────────────────────────────▶ agent
       ◀── 402 + PAYMENT-REQUIRED (wARS, USDC, USD₮, USA₮) ─┘
client signs Permit2 transfer (+ EIP-2612 permit, no gas)
client ── GET /ar/dolar + PAYMENT-SIGNATURE ─────────▶ agent ── /verify ─▶ api.x402.celo.org
                                                       agent runs the query
                                                       agent ── /settle ─▶ api.x402.celo.org ─▶ Celo mainnet
       ◀── 200 JSON + PAYMENT-RESPONSE (tx hash) ─────┘
```

- Server: [Hono](https://hono.dev) + official `@x402/hono`, `@x402/core`, `@x402/evm` v2,
  facilitator `https://api.x402.celo.org` (network `eip155:42220`).
- wARS route: `extra = { name: "Peso Argentino", version: "1", assetTransferMethod: "permit2" }`
  and the `eip2612GasSponsoring` extension declared on every route.
- Same code runs on Node (`src/node.js`) and Cloudflare Workers (`src/worker.js`).

### Identity and attribution

- **ERC-8004:** the agent registers in the Celo mainnet IdentityRegistry
  (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) from its own wallet with
  `scripts/register-agent.js`; the registration file is served by the agent itself.
  Registered as **agentId 9988** (`eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`),
  tx `0x76a16796…f38f` ([agent wallet on Celoscan](https://celoscan.io/address/0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1)),
  agent URI `https://landingen24h.com/celo/.well-known/agent-registration.json`.
- **ERC-8021 attribution tag:** the project's code is **`celo_85d42ed6ebcf`**, the code issued
  at hackathon enrollment (`src/attribution-code.js`, the single source of truth). It is attached
  once, where the wallet client is built (`taggedWalletClient` = viem client extended with
  `withAttribution` from `@celo/attribution-tags`), so every transaction the project sends
  itself carries it. (The ERC-8004 registration above predates enrollment and carries an
  earlier, repo-derived code.)
- **x402 settlements** are submitted by the Celo facilitator, which does not write tags yet.
  Every 402 response declares the app code through the x402 `builder-code` extension
  (`{ a: "celo_85d42ed6ebcf" }`), which the facilitator picks up once it writes ERC-8021
  Schema 2 tags; until then settlements are attributed through the **PayTo** wallet below.
- **Gas:** payers pay no gas. Settlement gas is paid by the Celo facilitator from the seller's
  facilitator account, not by this project's wallet.

PayTo / agent wallet: `0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1`

### Live on Celo mainnet

- Endpoint: `https://landingen24h.com/celo/` (catalog and prices at `/celo/prices`,
  registration file at `/celo/.well-known/agent-registration.json`).
- First end-to-end payment (our own test buyer wallet, holding only wARS and no CELO):
  `GET /celo/ar/dolar` paid **15 wARS**, settled by the Celo facilitator in
  `0xd1cd54e6…e7db` ([agent wallet on Celoscan](https://celoscan.io/address/0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1))
  (wARS `Transfer` 0x1731…6d72 → PayTo), HTTP 200 with the quotes JSON. This was a self-test,
  not a customer sale.
- **Build with buy** proof: the agent bought one LLM completion from the Buy gateway
  (`gateway.usebuy.ai/cencori`) via x402, paying **0.01 USDT** on Celo in
  `0xeed25bea…dd9a` ([agent wallet on Celoscan](https://celoscan.io/address/0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1))
  (`scripts/buy-proof.js`, receipt `success: true`).

### USA₮ accepted

Every paid route also accepts **USA₮** (Tether America USD, issued by Anchorage Digital Bank),
`0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` on Celo, 6 decimals, settled gasless through the
Celo facilitator with EIP-3009 (`extra: { name: "Tether America USD", version: "1" }`). The address
matches usat.io/supported-protocols, docs.celo.org and the facilitator's own `/supported` table.

### The agent buys, too (Build with buy, behind a flag)

`/ar/brief?lang=es|en` (45 wARS or 0.03 USD) returns today's USD/ARS quotes plus a 3-sentence
plain-language brief. To write it, the agent **buys** one LLM completion it does not own:
Cencori inference sold through the [Buy](https://usebuy.ai) gateway on Celo, a flat 0.01 USD per
call in USA₮ (or USD₮/USDC), paid over x402 from the agent's own wallet (`src/buy.js`).

- The payer signs through the attribution-tagged wallet client (`taggedWalletClient`).
- Spend rails before anything is signed: only the Buy gateway's payTo, only Celo, only the chosen
  token, a hard 0.01 per-payment cap and a daily call budget.
- Settle first: `/ar/brief` settles the caller's payment BEFORE buying upstream (x402 `upfront` flow,
  `extra.paymentFlow` in the 402), because verify checks a balance but does not hold it. Replay lock
  and budget unit are taken before settle, so a refused call is never charged; a failed settle hands
  the unit back. If the upstream call then fails, the 502 carries a free one-time
  `retry_url` (`/ar/brief/retry?token=...`, 48 h), so a paying caller still gets the brief.
- Replay lock: before buying, the agent claims the caller's payment key (payer + EIP-3009 nonce) in a
  global store and refuses a key it has seen (`409 payment_already_used`), so one caller payment can
  never trigger more than one upstream purchase, even when replayed in parallel before it settles.
- The daily budget is global, not per isolate: on Workers both checks run in one Durable Object
  (`BriefGuard` in `src/guard.js`, binding `BRIEF_GUARD`), which serializes them.
- Off unless `BUY_ENABLED=1`, `BUY_PRIVATE_KEY` **and** the `BRIEF_GUARD` binding are set (optional
  `BUY_ASSET`, `BUY_MAX_PER_DAY`). Without the guard the route stays off (fail closed).
  **Status: off in production** (`/celo/ar/brief` answers 404); the one-time mainnet proof is above.
  Dry-run the live quote with `node scripts/buy-proof.js` (signs nothing).

## Use it

### Pay from a script (agent or developer)

```bash
npm install
BUYER_PRIVATE_KEY=0x... node scripts/pay.js "https://<host>/ar/dolar?casa=blue"          # pays in wARS
BUYER_PRIVATE_KEY=0x... node scripts/pay.js "https://<host>/ar/cuit?cuit=20123456786" USDC   # or USDT, USAT
```

`scripts/pay.js` uses the stock `@x402/fetch` client, opts wARS into its spend controls
with a hard per-call cap (50 wARS by default), and only signs for the asset you chose.

### Get wARS

`GET /ramp?address=0xYourWallet&amount=10000` returns a `ramp.ripio.com` link
(`country=AR&chain=42220&token=WARS`) that buys wARS with ARS and sends it to that wallet on Celo.

### Run your own

```bash
cp .env.example .env    # set PAY_TO and X402_API_KEY (from https://x402.celo.org)
npm install
npm test                # unit + payment-gate tests (mock facilitator, offline)
npm run test:live       # + checks a real wARS payload against api.x402.celo.org/verify (no funds moved)
npm start               # Node on :8787
# or Cloudflare Workers:
npx wrangler secret put X402_API_KEY && npx wrangler deploy
```

### Register the agent (ERC-8004)

```bash
AGENT_ADDRESS=0x... node scripts/register-agent.js https://<host>/.well-known/agent-registration.json            # dry run
AGENT_PRIVATE_KEY=0x... node scripts/register-agent.js https://<host>/.well-known/agent-registration.json --send --fee-usdt
```

`--fee-usdt` pays gas in USD₮ through Celo fee abstraction, so the agent wallet needs no CELO.

## Use it from an MCP client (Claude, Cursor, any agent)

The repo ships a stdio MCP server with six tools: `ar_dolar`, `ar_inflacion`,
`ar_feriados`, `ar_cuit`, `ar_cbu` and the free `ar_ramp_link`.

```json
{
  "mcpServers": {
    "ar-data-agent": {
      "command": "npx",
      "args": ["-y", "github:landingen24h/ar-data-agent"],
      "env": { "AR_AGENT_PRIVATE_KEY": "0x... (a Celo wallet holding a few wARS)" }
    }
  }
}
```

- **Quote mode (free):** leave `AR_AGENT_PRIVATE_KEY` unset. Every tool returns the price and
  the x402 payment requirements; nothing is paid. Good for wiring it into your agent first.
- **Paid mode:** set the key. Each call pays the exact price in wARS (or `AR_AGENT_ASSET=USDC` / `USDT` / `USAT`)
  and returns the data plus the settlement tx. A per-call cap applies (`AR_AGENT_MAX_WARS`, default 20).
  The payer needs no CELO: the Celo facilitator pays gas.
- Use a dedicated low-balance wallet for the key, never your main one.

### Run it with Docker

The repo also has a `Dockerfile` for the same stdio server (Node 22, production dependencies only):

```bash
docker build -t ar-data-agent .
docker run -i --rm ar-data-agent                                  # quote mode
docker run -i --rm -e AR_AGENT_PRIVATE_KEY=0x... ar-data-agent    # paid mode
```

`-i` keeps stdin open, which an MCP stdio server needs.

## For other hackathon teams

If your agent works with Argentina (payroll, invoices, remittances, pricing in pesos, contract
indexation, settlement dates), you can call this instead of scraping: it is live on Celo mainnet
now and costs 10 to 15 wARS per call. Open an issue in this repo if you need a route that is
not here (another rate, a province holiday calendar, a different validation); reasonable
requests get built. Live description: <https://landingen24h.com/celo/?r=gh-readme>.

## Security review

Feedback from Zealynx on the Celo forum (26 Oct 2026), and what changed:

1. **Pin payTo in the client scripts and MCP server** so a changed `AR_AGENT_URL` cannot redirect
   payments: done in `f7868d6` (override only through an explicit `AR_AGENT_PAY_TO`).
2. **Lock the caller's payment nonce before buying upstream in `/ar/brief`**: done (`src/guard.js`),
   with tests for sequential replay, a 5-way parallel race and cross-isolate replay.
3. **`dailyBudget` was per isolate**: replaced by a global per-UTC-day budget in the same Durable
   Object; an error from the guard refuses the purchase.
4. **Funds can move between verify and settle** (one balance reused across fresh addresses):
   `/ar/brief` now settles before the upstream purchase, with a one-time retry token if upstream fails.

Found a problem? See [SECURITY.md](SECURITY.md) for how to report it privately; anything else, open an issue.

## Tests

`npm test` covers the validators and data shaping (CUIT, CBU, dolar, inflacion, feriados
incl. business days across holidays and year end), prices in base units, the 402 body
(wARS first, Permit2 + gas sponsoring), a full signed payment through the official client
against a mock facilitator, no settlement on upstream failure, free rejection of bad
input, the attribution code, the wallet client tagging every transaction exactly once, and
the `builder-code` declaration on every paid route, and the `/ar/brief` replay lock and global budget. `npm run test:live` also sends a
wARS payment signed by a fresh empty wallet to the real Celo facilitator's `/verify`,
which accepts the Permit2 and EIP-2612 signatures and fails only at the balance transfer.

## License

MIT, Landing en 24h.
