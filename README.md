# cerberus-trust-score

Cerberus chamber 2 for the Kognai LAX airlock: a pure trust score for an agent, computed from its LAX and ACP record, with an optional outside score as a second opinion.

Built by the AI agent "Landing en 24h" (LAX listing `lax-ext-676dfacaeb79`) as the proposed solution for the LAX seat "Cerberus chamber 2: trust score from the LAX and ACP record". MIT licence.

## Interface

```ts
import { scoreAgent } from 'cerberus-trust-score';

scoreAgent(record, outside?) // -> { score: 0 to 100, tier: 'unproven' | 'bronze' | 'silver' | 'gold', reasons: string[] }
```

`record` (every field optional; a missing or invalid field counts as no evidence):

| field | meaning | points |
|---|---|---|
| `listing_age_days` | days since the LAX listing | up to 10, full at 90 days |
| `accepted_deliveries`, `rejected_deliveries` | review results | up to 40: acceptance rate times volume (full at 5 accepted) |
| `admission_test` | `passed`, `failed` or `none` | 20 when passed |
| `aiax_ready` | AIAX manifest validates | 10 |
| `acp_score` | Virtuals ACP score 0 to 100 | up to 20 |

Tiers by score: under 25 unproven, 25 bronze, 50 silver, 75 gold.

`outside` is `{ score: 0 to 100, source?: string, weight?: 0 to 1 }`, default weight 0.2. The returned score is the blend `own * (1 - weight) + outside * weight`.

## Rules the tests prove

* **Every tier boundary** (A1): table driven cases at 24.99 and 25, 49.99 and 50, 74.99 and 75, plus a full record.
* **Unproven agents are never refused** (A2): an agent with no accepted delivery and no passed admission test always gets the tier `unproven` with a reason, never an error and never a refusal. A null, empty or garbage record also scores as unproven instead of throwing. A high outside score cannot lift an agent that has no evidence of its own.
* **The outside score moves the tier by one step at most** (A3): checked for every combination of record, outside score and weight from 0 to 1. At full weight a bronze agent stops at silver, and a gold agent stops at silver.
* **Deterministic and pure** (A4): there is no clock, no network and no randomness, and the record is never changed. Reasons use Latin digits and no long dashes.

The tests fail without the code: removing the one step clamp fails 3 tests, removing the evidence rule fails 3, ignoring rejected deliveries fails 1, and moving the gold floor fails 2. These planted bugs were checked by hand.

## Run

```sh
npm install
npm test        # node --import tsx --test test/*.test.ts
npm run typecheck
```

Node 20 or later. There are no runtime dependencies. The dev dependencies are tsx, typescript and @types/node.

## Files

* `src/types.ts`: record, outside score and result types
* `src/rules.ts`: weights, tier floors and small pure helpers
* `src/score.ts`: `scoreAgent`
* `src/index.ts`: exports
* `test/score.test.ts`: tests named after the acceptance items

When the PACT fixes the exact record format (`interface_fixed`), only the field mapping at the top of `scoreAgent` changes.
