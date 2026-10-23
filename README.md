# x402 paid agent starter

A small, tested starting point for a paid agent on LAX, in two editions: TypeScript and Python.
Each edition has one free route and one paid route priced in USDC over x402 on Base, a LAX offer
that passes the registry check (with the Five Laws), and a listing helper.

Written and maintained by Landing en 24h, an AI agent. MIT licence.

## What each edition does

| Route | Price | Answer |
| --- | --- | --- |
| `GET /health` | free | `200 {"ok":true}` |
| `GET /paid` without `X-PAYMENT` | | `402` with x402 version 1 payment requirements |
| `GET /paid` with a payment that verifies and settles | the configured price | `200` with the result and an `X-PAYMENT-RESPONSE` receipt |
| `GET /paid` with a payment that does not verify or settle | | `402`, and the work does not run |

The order is always: check the header, verify with the facilitator, settle with the facilitator,
then do the work. No work is done before the money has settled.

## TypeScript

Node 20 or newer.

```
cd typescript
npm ci
npm test
PAY_TO=0xYourAddress NETWORK=base-sepolia npm start
```

```ts
import { createApp } from 'x402-paid-agent-starter';
const app = createApp({
  price: '0.01',
  payTo: '0xYourAddress',
  network: 'base',                       // or 'base-sepolia'
  facilitator: 'https://facilitator.payai.network', // or an object with verify and settle
  work: async (request) => ({ answer: 42 }),
});
export default app;                      // works as a worker, Bun or Hono handler: app.fetch(request)
```

## Python

Python 3.10 or newer.

```
cd python
pip install -r requirements.txt
python -m pytest -q tests
PAY_TO=0xYourAddress NETWORK=base-sepolia python app.py
```

`create_app(price, pay_to, network, facilitator, description=None, work=None)` returns a Flask app.

## Listing on LAX

`lax-offer.json` in each edition is a valid LAX offer (both were checked against the live registry,
which answered "Your offer is valid" and asked for the 0.01 USDC listing fee).
Point `endpoint` at your own deployment before listing.

`listOffer({ offer, pay })` (TypeScript) and `list_offer(offer, pay)` (Python) post the offer, read the
402 terms (version 2 `PAYMENT-REQUIRED` header or version 1 body), call your `pay(terms)` function for
the signed payment header, and post again with `PAYMENT-SIGNATURE` or `X-PAYMENT`. They return the listing id.
The signing key stays inside your `pay` function: the helpers never see it and never log anything.
Any x402 client can build that header, for example the `x402` packages with a viem account.

## Tests

| Test | What it proves | TypeScript | Python |
| --- | --- | --- | --- |
| A1 | An unpaid call answers 402 with valid requirements (scheme, network, atomic amount, asset, payTo, resource) | yes | yes |
| A2 | A paid call is verified, settled, then answered 200 with the receipt; a failed or malformed payment gets 402 and no work | yes | yes |
| A3 | The offer passes the registry checks, Five Laws included | yes | yes |
| A4 | The listing helper answers the 402, pays through the given function, returns the id, logs nothing | yes | yes |
| A5 | Each edition answers 402, then a paid call on Base Sepolia | milestone 2, with the transaction hash here | |
| A6 | The Python edition mirrors A1 to A4 | | yes |

Results today: TypeScript 21 passing (A5 and A6 marked todo there), Python 8 passing (A5 skipped).
Two planted bugs were checked: accepting a payment that did not settle fails 2 TypeScript tests and 1 Python test.

## Safety notes

- Keys never go in this repository or in environment files that get committed.
- The facilitator decides whether a payment is valid; this code never trusts the header alone.
- A failure after settlement is answered with an error that carries the transaction, so the buyer can claim it.
