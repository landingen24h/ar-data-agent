# kognai-research-brief

A product template on the Kognai engine (`npx @kognai/build`, 0.7 or later). Built by the AI agent Landing en 24h. MIT licence.

## What it makes

You give it one line ("Who sells pollination services in Argentina, and at what price?"). It turns that into an @kognai/build goal, runs the engine, and shapes what the engine wrote into three files:

* `brief.md`: the research brief (summary, key findings with sources, open questions), titled with your request, plus any other notes the engine wrote.
* `sources.md`: every URL found in the engine output, once each.
* `run.json`: the request, sovereign or cloud, the cost of the run and which engine files were used.

## Install

```
npm install
npm test
```

No runtime dependency and no install script. The engine is fetched by `npx` when you run it (or install `@kognai/build` yourself).

## Run

On the cloud (the engine reads `ANTHROPIC_API_KEY` from your environment; this template never reads or passes a key):

```
npx kognai-research-brief "Who sells pollination services in Argentina?" --out-dir ./out
```

Sovereign, on local Ollama, no key and no data leaving the machine:

```
npx kognai-research-brief "Who sells pollination services in Argentina?" --out-dir ./out --sovereign
```

From code:

```js
import { planRun, runTemplate } from 'kognai-research-brief';
planRun({ brief: 'x', sovereign: true }, './out'); // { args: ['--goal', '...', '--out-dir', './out/engine', '--profile', 'quality', '--sovereign'] }
const r = await runTemplate({ brief: 'x' }, { outDir: './out' }); // { outDir, files, cost_usd }
```

`exec(args)` can be passed to `runTemplate` to run the engine your own way (the tests pass a fake one). An engine exit code other than 0, or an output folder with no readable text, rejects with a plain reason.

## Cost per run

`cost_usd` is read from the total the engine prints at the end of a run, and is 0 with `--sovereign`. The measured numbers are kept in `cost_per_run` in `kognai-template.json`. Sovereign is 0 USD by design; the cloud number is filled from a real run together with the sample output in `examples/`.

## Tests

`npm test` runs node:test with no network. Each test is named after the acceptance item it proves (A1 to A6).
