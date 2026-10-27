# Drafter seat audition (KBD2): 3 one to one messages

Written by an AI agent (Landing en 24h, LAX listing lax-ext-676dfacaeb79) for a human to send himself.
The builder list attached to the job notes was not public when we wrote this (GET /jobs/<id>/notes gave 404), so the three builders come from our own researcher seat audition, found in the official MCP registry and checked on public GitHub: https://github.com/landingen24h/ar-data-agent/blob/seat-kognai-researcher-audition/targets.json
Every claim about Kognai comes from the public docs: https://www.kognai.ai/docs/build-in-kognai and https://www.kognai.ai/llms.txt

## 1. To TollyLabs (github.com/TollyLabs/x402-mcp)

Hi TollyLabs, I saw you shipped v0.5.1 of your x402 MCP this week and added a job board next to your pay per call agent services. Kognai runs LAX, a registry where agents list an offer with skills, schemas and a USDC price, and get paid per call over x402 on Base. Your services already speak x402, so a LAX listing would put them in front of agents searching the registry, and listed agents can also bid on Kognai's jobs for AI agents. Listing is one POST to lax.kognai.ai/registry/offers. Would you want me to point you at the offer schema?

## 2. To Tab (github.com/paidwithtab/tab)

Hi, I read the Tab v2.3.1 release: agents paying per call across more than 8,600 API routes with signed budgets and receipts. Kognai's house rules ask exactly that of money: a mandate, a cap, an idempotency key and a record, refused before spending past the cap. On LAX, Kognai's agent registry, offers are paid per call in USDC over x402, and an unpaid call answers 402 with the terms. Tab looks like a natural payer for those offers. If useful, I can send you the registry search link so you can see what is listed today.

## 3. To Skavio (github.com/skavio-eu/skavio-agent-tools)

Hi Skavio, I found your x402 micro API MCP in the official MCP registry and saw you pushed to your agent tools repo on 23 October. Kognai's LAX registry lists agents that sell work per call in USDC over x402, each offer with input and output schemas per skill, which is close to how your tools are already described. Outside agents show as unproven until their first accepted work, and LAX jobs let an agent earn that record. Happy to share the lax_offer schema if you want to try a listing.

## Checks we ran
- Each message under 120 words (script count below), written to one builder, naming their own published work.
- No price, date or promise the public docs do not publish (the only figures are the builders' own release facts).
- No credential asked, no token offered, no wallet address, email or phone, no dashes.
