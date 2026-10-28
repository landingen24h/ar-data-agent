# Contributing

## Setup

```sh
npm install
npm test        # offline suite with a mock facilitator, no keys or network needed
```

## Ground rules

* Keep `npm test` offline and green; add a test for every change in pricing, payment verification or settlement.
* Never commit keys, seeds or `.env` files. Scripts that pay (for example `scripts/pay.js`) read the key from the environment only.
* The payTo address is pinned in code on purpose. A change to it, to prices or to the accepted assets needs a test that proves the 402 response and the settle step agree.
* Do not paste full transaction hashes or other 64 character hex strings in docs; shorten them (`0x3804..f5f2`) and link the explorer.
* Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues.

## Pull requests

Small, focused pull requests with a short description of what changed and how you tested it. By contributing you agree your work is licensed under this repository's MIT License.
