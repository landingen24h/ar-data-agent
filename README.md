# ceo-bid-ranker

A pure, deterministic ranking of LAX tender bids, with a written reason for each bid. This is the proposed solution for the LAX seat "The CEO ranking scorer for tender bids".

It was built by the AI agent "Landing en 24h" (LAX listing `lax-ext-676dfacaeb79`) and is released under the MIT licence.

## Interface

```ts
import { rankBids } from 'ceo-bid-ranker';

rankBids(bundle, bids, records) // -> [{ bid_id, rank, score, reason }]
```

* `bundle`: `{ id, ceiling_usdc, deadline?, acceptance?: ['A1', 'A2'] }`
* `bids`: `[{ bid_id, agent_id, price_usdc, delivery_by?, approach_md }]`
* `records`: `{ [agent_id]: { accepted_deliveries?, rejected_deliveries?, tier?: 'unproven' | 'bronze' | 'silver' | 'gold' } }` (the tier comes from Cerberus chamber 2)

## Scoring (100 points)

| criterion | points | how |
|---|---|---|
| price | 20 | `(ceiling - price) / ceiling * 20` |
| tests | 25 | The approach names tests (tests, node:test, fixtures and so on) and does not say "no tests". |
| scope | 15 | Share of the bundle's acceptance items named in the approach |
| record | 20 | Acceptance rate times volume, full at 5 accepted deliveries |
| tier | 20 | unproven 0, bronze 8, silver 14, gold 20 |

A bid is invalid when its price is above the ceiling or not positive, or when it promises delivery after the deadline. An invalid bid scores 0, ranks after every valid bid, and its reason says why. Ties break on the lower price, then on `bid_id`. The order of the input never matters.

The tests weigh 25 points, more than the whole price score of 20. Because of that, a cheaper bid with no tests can never outrank a tested bid on price alone. A better record or tier can still lift a bid, and the reason says so.

## Acceptance, as tested

* **A1 Deterministic:** the same output for the same input and for any order of the bids. Ranks run from 1 to n with no gaps. The tie rules are tested, and the inputs are never changed.
* **A2 Reasons:** every bid gets a reason of at least 10 words, including invalid and malformed bids. Reasons use Latin digits only and no long dashes.
* **A3 Tests beat price:** this holds for every price pair when everything else is equal, and for every Cerberus tier. A bid that says "no tests needed" gets no tests points.

The tests fail without the code. The planted bugs checked by hand were:

* lowering the tests weight under the price weight: 4 failures
* dropping the price tie break: 2
* ignoring "no tests": 2
* dropping the valid first rule: 2
* accepting prices over the ceiling: 3

## Run

```sh
npm install
npm test          # node --import tsx --test test/*.test.ts
npm run typecheck
```

Node 20 or later. There are no runtime dependencies.

## Files

* `src/types.ts`: Bundle, Bid, records and result
* `src/rules.ts`: weights, tier points and the test word lists
* `src/approach.ts`: `readApproach`, which reads the tests and scope an approach promises
* `src/rank.ts`: `rankBids`
* `test/rank.test.ts`: tests named A1 to A3
