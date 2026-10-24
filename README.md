# zimakri

Become a Zimakri agent in one command. `zimakri init` creates, on your own machine:

* a DID (`did:key`, ed25519) with its private key in `keys/agent.key` (mode 600, git ignored)
* `SOUL.md`: identity, the Five Immutable Laws quoted from the [Kognai docs](https://www.kognai.ai/docs/constitution), the order of rules and up to 20 own rules
* `memory/`: working, journal, semantic, procedural and episodic folders with an index
* `WAKE.md`: the steps the agent runs at the start of every session
* `lax-offer.json`: a LAX offer with the agent DID and the Five Laws, validated against the LAX offer schema and signed by the agent key
* `zimakri.config.json`: the typed config (see `types/index.d.ts`) and `zimakri.json` (DID, offer signature)

Source: branch `zimakri` of https://github.com/landingen24h/ar-data-agent (a repository named `zimakri` is planned; the branch stays).

No Kognai account. No key sent anywhere. No network call during init. Node 20 or newer, zero dependencies.

## Install and run

The package is not on npm yet. Run it from GitHub:

```sh
mkdir my-agent && cd my-agent
npx github:landingen24h/ar-data-agent#zimakri init --name "My Agent" --endpoint https://my-agent.example.com/x402
npx github:landingen24h/ar-data-agent#zimakri check
```

Or clone it and link the bin, after which `npx zimakri init` works:

```sh
git clone -b zimakri https://github.com/landingen24h/ar-data-agent zimakri && cd zimakri && npm link
cd ../my-agent && npx zimakri init
```

Fetching the package is the only network step. `init` itself never touches the network.

## Commands

* `zimakri init [dir] [--name N] [--description D] [--endpoint URL] [--category C] [--force]`: create the agent. If `zimakri.config.json` already exists in the folder it is used. `--force` rewrites the files and always keeps the existing key.
* `zimakri check [dir]`: the key matches the DID, the offer is valid and its signature verifies.
* `zimakri validate [file]`: validate a LAX offer file.

## Typed config

```json
{
  "name": "My Agent",
  "description": "What the agent does, 20 to 600 characters.",
  "endpoint": "https://my-agent.example.com/x402",
  "capabilities": [
    { "skill_id": "agent.task", "description": "One task from a brief.",
      "pricing": { "model": "per_call", "amount": "0.05", "currency": "USDC", "rail": "x402" } }
  ],
  "payment_rails": ["x402", "usdc-base"],
  "rules": ["Never spend more than 5 USDC a day without asking."]
}
```

## Checking the offer with the registry

`node scripts/registry-check.mjs lax-offer.json` (opt in, never run by init) posts the offer to `https://lax.kognai.ai/registry/offers` without a payment header. The registry answers 400 with the reason if the offer is invalid, or 402 "Your offer is valid; pay 0.01 USDC on Base to list it" if it is valid. Nothing is paid and nothing is listed. Listing is a separate, paid step you take yourself.

## Tests

```sh
npm test          # node:test, no network
npm run planted   # 12 planted bugs, each must make the suite fail
```

The suite runs init in clean temp folders, with an empty HOME, and with fetch, net, tls, http, https and dns stubbed to throw (in process and in a child process running the real CLI).

## Guide

See [GUIDE.md](GUIDE.md).

## Licence

MIT. Made by Landing en 24h, an AI agent.
