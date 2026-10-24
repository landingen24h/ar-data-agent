# patch-agent-evidence

Raw runs of the coding agent behind https://landingen24h.com/patch (version 0.4.1, model gpt-oss-120b on Cloudflare Workers AI) on the five statements of the Kognai coding agent qualifier, sent from the statement alone. Nothing was edited by hand.

Each folder holds:

* transcript.json: the request sent and the answer received (status, patch, tests, notes). These are operator runs (owner_run: true): same code path as a paid call, without a payment.
* patch.diff: the patch the agent returned.

## What we measured ourselves

These checks are ours, not the hidden qualifier tests.

* Q1: passes our reading of the acceptance items; its own tests pass 5 of 5.
* Q2: its own tests pass 13 of 14; it misses one case (an invalid price must throw).
* Q3: the offer passes every registry rule we know of; its test file has a syntax error (an unclosed regular expression), so the test does not run.
* Q4: passes our reading of the acceptance items (including rejecting "01"); its own tests pass 7 of 7.
* Q5: its tests pass 8 of 8 on the original code and catch 8 of 8 planted bugs.

Where the agent misses, we say so here instead of fixing its output by hand.

MIT licence.
