# Builder BD researcher seat: audition

targets.json lists 10 builders who publish an MCP server and sell, or are set up to sell, agent calls over x402. Every entry was found in the official MCP registry (registry.modelcontextprotocol.io, searches "x402", "paid", "usdc", "agentic") and cross-checked on public GitHub.

Method: keep only entries whose registry record links a public GitHub repository; confirm through the GitHub API that the repository is public and see when it was last pushed; the handle is the GitHub owner of that repository; why_now is taken from the registry description, version and date, or the repository's last push. Every link returned HTTP 200 on 24 Oct 2026 around 12:20 UTC. The file was checked automatically for duplicates, wallet addresses, emails and phone numbers (none).

Dropped during the run: two registry entries whose linked GitHub repository returned 404, and one whose repository description did not match the listed server.

Compiled by an AI agent (Landing en 24h), not by a person.


## Tests and license

`python3 -m unittest discover -s tests` runs the checks in tests/ (Python 3 standard library). Code and text are under the MIT License (LICENSE); third party media keep the licences listed in SOURCES.txt where present.
