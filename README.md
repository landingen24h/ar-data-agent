# AR Data Agent: Argentine data, paid per call in pesos on Celo

A small, autonomous HTTP agent that sells Argentine public data and validations to
other agents and to people, **priced in wARS** (Ripio's Argentine peso stablecoin) and
settled on **Celo mainnet** through **x402** and Celo's hosted facilitator.

No sign-up, no API key, no card, no conversion through the dollar: the caller signs a
wARS payment for exactly the price of the call and gets the JSON back. The payer needs
**no CELO for gas**: the facilitator pays settlement gas and sponsors the Permit2
approval (EIP-2612), so a wallet holding only wARS can pay.

Built for the *Agents on Open Rails* hackathon, track **Stable Agents: LatAm (Ripio x Celo)**.

## What it sells

| Route (GET) | Price | Alt. price | What you get |
|---|---|---|---|
| `/ar/dolar?casa=blue` | 15 wARS | 0.01 USDC / USD₮ | USD/ARS quotes: oficial, blue, MEP, CCL, cripto, tarjeta, mayorista, spread and blue-vs-oficial gap |
| `/ar/inflacion?from=2026-01&to=2026-09&amount=100000` | 15 wARS | 0.01 USDC / USD₮ | INDEC CPI: latest monthly and YoY, compounded inflation between months, amount adjuster |
| `/ar/feriados?date=2026-11-20&add_business_days=5` | 15 wARS | 0.01 USDC / USD₮ | National holidays, is-business-day, next business day, date + N business days |
| `/ar/cuit?cuit=20-12345678-6` | 10 wARS | 0.01 USDC / USD₮ | CUIT/CUIL check digit, entity type, formatting (offline) |
| `/ar/cbu?cbu=0070999003000412345671` | 10 wARS | 0.01 USDC / USD₮ | CBU/CVU check digits, CBU vs CVU, bank (offline) |

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
       ◀── 402 + PAYMENT-REQUIRED (wARS, USDC, USD₮) ─┘
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
  tx [`0x76a16796…f38f`](https://celoscan.io/tx/0x76a16796806af337295983a784ebea8e1b30d63633686c8250a7e097d852f38f),
  agent URI `https://landingen24h.com/celo/.well-known/agent-registration.json`.
- **ERC-8021 attribution tag:** every transaction this project sends itself (the ERC-8004
  registration, test payments) carries the tag from `@celo/attribution-tags`. The code is
  `codeFromRepo("landingen24h/ar-data-agent")`, asserted at startup in `src/attribution.js`.
- **x402 settlements** are submitted by the Celo facilitator, which does not carry tags yet;
  they are attributed through the **PayTo** wallet listed below.
- **Gas:** payers pay no gas. Settlement gas is paid by the Celo facilitator from the seller's
  facilitator account, not by this project's wallet.

PayTo / agent wallet: `0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1`

## Use it

### Pay from a script (agent or developer)

```bash
npm install
BUYER_PRIVATE_KEY=0x... node scripts/pay.js "https://<host>/ar/dolar?casa=blue"          # pays in wARS
BUYER_PRIVATE_KEY=0x... node scripts/pay.js "https://<host>/ar/cuit?cuit=20123456786" USDC
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

## Tests

`npm test` covers the validators and data shaping (CUIT, CBU, dolar, inflacion, feriados
incl. business days across holidays and year end), prices in base units, the 402 body
(wARS first, Permit2 + gas sponsoring), a full signed payment through the official client
against a mock facilitator, no settlement on upstream failure, free rejection of bad
input, and the attribution tag on the ERC-8004 calldata. `npm run test:live` also sends a
wARS payment signed by a fresh empty wallet to the real Celo facilitator's `/verify`,
which accepts the Permit2 and EIP-2612 signatures and fails only at the balance transfer.

## License

MIT, Landing en 24h.
