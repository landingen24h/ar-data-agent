# Golden Kog risk debate

A small TypeScript module that adds a two sided structure debate to a token risk analysis. Two advocates argue from measured facts, one for a sound structure and one for a fragile structure, then a reviewer weighs them. It is a risk tool, never a trading tool: no buy or sell view, no price target, no entry or exit, no advice. The debate never returns or changes a level or points.

No runtime dependency. Node 22 (also runs on Node 20). MIT licence.

```ts
import { debate } from './src/debate.ts';
const d = await debate(
  { facts_text, level, points, flag_ids, unknown },
  { route, check, mode: 'shadow', log, timeoutMs: 45000 },
);
```

## Call flow

```
debate(input, deps)
  mode off            -> no route call, status off
  route(sound,   exec) \
                        >  in parallel, each part checked against the rules
  route(fragile, exec) /   a failing part becomes the fixed sentence, reasons kept in rejected
  route(reviewer, apex)    gets facts_text and both advocate texts, answers JSON
                           {text, weight, unknown, tension?}
  parse and check reviewer -> unparseable or failing: status rejected, empty texts
  weight filtered to flag_ids
  whole run over timeoutMs -> status timeout (never throws)
  shadow: log(Debate), shown false      on: shown true      usd = sum of cost_usd
```

Every route call carries `task_type: 'risk_debate'`, `tier_class: 'text'`, `constitutional_flag: false`, `agent_id: 'golden-kog'`, a `context_tokens` estimate and `payload: {role, system, prompt, max_tokens}`.

## Rules

Every part (each advocate text, the reviewer text, its tension and unknown items) must pass all of these, in `src/rules.ts`:

1. Every number in it appears in facts_text, written the same way (`18500` does not match `18,500`).
2. None of the refused words: bull, bear, bullish, bearish, upside, downside target, undervalued, overvalued, accumulate, moon, buy now, sell now, price target, entry, exit, take profit, not financial advice. Matched as whole words, any case.
3. `deps.check(text)` returns nothing.
4. At most 180 words per advocate and 150 for the reviewer.
5. Latin digits only and no dash characters (figure, en, em and other long dashes, minus sign).

A failing advocate part becomes exactly "No case could be written from the measured facts." and its reasons go in `rejected` (prefixed `sound:` or `fragile:`). A failing or unparseable reviewer part gives status `rejected` with empty texts. A route call that throws is handled the same way.

## Example Debate

The test fixture (`test/helpers.ts`) run with `mode: 'on'`:

```json
{
  "status": "ok",
  "shown": true,
  "sound": "Mint authority is revoked, so no new supply can be created after launch. Pool depth of 18,500 USD gives some room for ordinary transfers.",
  "fragile": "The top 10 holders own 62.4 percent of supply and liquidity locked is 0 percent. Freeze authority is still active, and the token is 3 days old.",
  "reviewer": "The fragile case weighs more: concentration at 62.4 percent with 0 percent locked liquidity and an active freeze authority outweigh the revoked mint.",
  "weight": ["concentration", "unlocked_liquidity"],
  "unknown": ["team wallets"],
  "tension": "Revoked mint against active freeze authority.",
  "models": { "sound": "model-sound", "fragile": "model-fragile", "reviewer": "model-reviewer" },
  "usd": 0.0063,
  "rejected": []
}
```

The id `made_up_rule` that the fixture reviewer returned is dropped from `weight` because it is not in `flag_ids`.

## Tests

`npm test` runs node:test with tsx, no network. Each test is named after the acceptance item it proves, A1 to A7. `npm run typecheck` is clean.

## Credit

The two advocates and a reviewer pattern is adapted from [TradingAgents](https://github.com/TauricResearch/TradingAgents) by TauricResearch (Apache 2.0), without its trader or portfolio manager roles. No code is copied.

Built by the AI agent Landing en 24h.
