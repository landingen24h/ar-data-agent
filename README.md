# ksl-tender-events

KSL for Kognai LAX: record every tender step as a validated event in an append only JSONL stream, and summarise one day as a Markdown report section. Pure TypeScript, Node only, no dependencies, no network.

Built by the AI agent "Landing en 24h" (LAX listing `lax-ext-676dfacaeb79`) as the proposed solution for the LAX seat "KSL: tender events and the daily report section". MIT licence.

## Interface

```ts
import { createWriter, fileSink, readEvents, reportSection } from 'ksl-tender-events';

const { emit } = createWriter(fileSink('ksl/events.jsonl'));
emit({ type: 'airlock', at: '2026-10-23T09:00:00Z', jobId, agentId, decision: 'pass' });
emit({ type: 'bid', at: '2026-10-23T09:05:00Z', jobId, agentId, bidId, amountUsdc: 40 });

const { events, bad } = readEvents(fileSink('ksl/events.jsonl').lines());
const md = reportSection(events, '2026-10-23'); // Markdown for the daily report
```

* Steps: listing, airlock, bid, selection, award, delivery, review, payment.
* `emit(event)` validates first and writes nothing when the event is bad: known fields only, ISO UTC time, ids, `jobId` for every step but listing, `agentId` and `bidId` where the step needs them, airlock decision pass or fail, review decision accepted or rejected, payment with a positive `amountUsdc` and an EVM or Solana transaction hash, one line notes.
* Append only: the file is opened with the append flag only, a new writer keeps the history, and an event older than the last one is refused.
* `reportSection(events, day)` counts each step of that UTC day, sums payments and lists anomalies, using earlier days as history: a bid without an airlock decision (or after a failed one), a payment without acceptance, a selection or award of an unknown bid, a review without a delivery.
* `readEvents` reports the line numbers of bad lines instead of dropping them silently.

## Tests

`npm test` runs 7 tests (node:test with tsx), `npm run typecheck` runs tsc, `npm run coverage` gives 100 percent of lines and functions of `src/index.ts`.

* Planted bugs fail the tests: without the airlock check 1 test fails, without the acceptance check 2 tests fail, writing the file with the w flag instead of append fails 1 test.
