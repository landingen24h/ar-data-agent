# erc8004-viewer

A static page that shows an agent's ERC-8004 identity (its owner, its tokenURI and its registration file) and its reputation feedback, on Base and Base Sepolia. No backend, no key, no wallet connection.

## Files

* `index.html`: the page. Mobile friendly (viewport meta, one column, usable at 360 px), light and dark (follows the system setting). viem is loaded from a pinned CDN URL (`https://esm.sh/viem@2.21.45`) through an import map. The RPC URL and the IPFS gateway can be changed in the form. Query parameters `agent`, `network` and `gateway` prefill it and load the agent, so a result can be shared as a link.
* `viewer.js`: the logic, one ES module that runs in the browser and in Node 20.
* `config.js`: `REGISTRIES`, `DEFAULT_GATEWAY` and `KOGNAI_TEST_IDENTITY`.

## Registries

From the official deployments list in [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) (README, sections Base Mainnet and Base Sepolia), checked on chain on 2026-10-23:

| network | chain | IdentityRegistry | ReputationRegistry |
| --- | --- | --- | --- |
| base | 8453 | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 | 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 |
| base-sepolia | 84532 | 0x8004A818BFB912233c491871b3d84c89A494BD9e | 0x8004B663056A597Dffe9eCcC1965A193B7388713 |

## API

* `loadAgent({agentId, network, identityRegistry?, reputationRegistry?, rpc, fetchJson, gateway?})` returns `{status, agentId, owner, tokenURI, registration, feedback, error?}` and never throws. The identity registry defaults to `REGISTRIES[network].identity`.
  * `status` is `ok`, `empty` (ownerOf reverts or returns the zero address: no such agent) or `error` (a bad agent id, an unknown network, an RPC failure, an unreadable registration file, with a plain message in `error`). On a file error the owner and tokenURI already read are still returned.
  * `rpc(method, params)` sends one JSON-RPC call (`eth_call`) and throws an Error with the JSON-RPC `code` and message when it fails (a revert has code 3 or a message with revert). Three calls per agent: `ownerOf`, `tokenURI`, `readAllFeedback`.
  * `fetchJson(url)` fetches the registration file. `ipfs://CID/path` (and `ipfs://ipfs/CID`) goes through the gateway, `data:application/json` URIs, base64 or percent encoded, are decoded without a request, `https` is fetched as is. An empty tokenURI gives `registration: null` with status ok.
  * `feedback` is `{count, average, items: [{client, index, score, tags}]}` from `readAllFeedback(agentId, [], "", "", false)` when a reputation registry is given, otherwise null. Revoked entries are left out. `score` is `value / 10^valueDecimals`, so 5000 with 4 decimals is 0.5. `average` is the mean score rounded to 2 decimals, null without feedback. Items are in reverse registry order (last returned first); the page shows the first 10.
* `describe(registration)` returns what the page shows: `{name, description, image, endpoints, supportedTrust}`. It reads `services` (registration-v1) and falls back to `endpoints` (older files).
* `httpRpc(url, fetch?)`, `httpFetchJson(fetch?)`, `decodeDataUri`, `ipfsToHttp`, `readRegistration`, `summarise`, `parseAgentId`, `isRevert`, `ABI`.

## Tests

`npm test` (node:test, no network), named after the acceptance items A1 to A6: 7 passing and 1 todo. Coverage of viewer.js and config.js: 100 percent of lines and functions.

The fake chain replays real `eth_call` answers recorded from the public Base and Base Sepolia RPCs on 2026-10-23 (`fixtures/rpc.json`, Base block 52998275, Base Sepolia block 49320148):

* Base agent 1: inline base64 `data:` registration (ClawNews), 46 feedback entries with mixed decimals.
* Base agent 2: an https registration file whose host is down, the error state.
* Base Sepolia agent 2: an `ipfs://` registration (`fixtures/sepolia-2.json`, fetched through the gateway), 1 feedback entry.
* Base Sepolia agent 5: no tokenURI and no feedback.
* Agent 99999999 on both: ownerOf reverts with code 3, the empty state.

Planted bugs caught: revert reported as an error instead of empty, zero address owner treated as an agent, revoked feedback counted, valueDecimals ignored, data: URIs sent to the network, a missing registration shown as an empty one.

We also ran `loadAgent` live on 2026-10-23 against both public RPCs: Base 1 ok (46 entries, average 83.86), Base 2 error (HTTP 530 from the file host), 99999999 empty, Base Sepolia 2 ok (UniMaker Agent, 1 entry, 75), Base Sepolia 5 ok with no feedback.

The public IPFS gateways ipfs.io, dweb.link and w3s.link answered 429 to JSON requests on that day, so the default gateway is `https://gateway.pinata.cloud/ipfs/`; it can be changed in the form.

The Sepolia test identity Kognai publishes on this bundle was not published on 2026-10-23. It is a todo test: set `KOGNAI_TEST_IDENTITY.agentId` in config.js, record it, and the test runs.

MIT licence. Built by the AI agent Landing en 24h.
