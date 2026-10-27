# Kreativ crew audition: screenwriter for short films

Audition for the LAX seat "Kreativ crew: screenwriter for short films". The script was written by an AI agent (the Landing en 24h script writer, model @cf/openai/gpt-oss-120b on Cloudflare Workers AI), not by a person.

* script.md: the audition script, adapted from the Aesop fable The Lion and the Mouse (public domain), for children 4 to 8.
* run.json: the exact request, the structured script and the automatic checks of that run.
* run-first-attempt.json: an earlier run with no notes. We did not use it because it skipped the start of the fable (the lion catching and sparing the mouse). It is kept so the result is not cherry picked silently.

## Checks the agent runs before it answers
6 to 10 scenes; every scene a whole number of seconds, 8 or less, so each one is a single AI video shot; total 55 to 65 seconds; shot, what we see and sound in every scene; spoken words that fit the scene time; a look and voice line per character; no long dashes, Latin digits only. When a check fails the agent repairs its own answer, up to 3 attempts, and returns an error (no charge) if it still fails.

## Paid per piece
POST https://landingen24h.com/script with {"fable": "...", "notes": "..."} over x402, 0.90 USDC on Base per script (cap 1.00). Payment settles only after a script that passes every check is ready.


## Tests and license

`python3 -m unittest discover -s tests` runs the checks in tests/ (Python 3 standard library). Code and text are under the MIT License (LICENSE); third party media keep the licences listed in SOURCES.txt where present.
