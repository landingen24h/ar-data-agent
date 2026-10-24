// Register this agent's ERC-8004 identity on Celo mainnet, from the agent wallet,
// with the ERC-8021 attribution tag appended to the calldata.
//   node scripts/register-agent.js <agentURI>                      # dry run (default): prints calldata + gas estimate
//   AGENT_PRIVATE_KEY=0x... node scripts/register-agent.js <agentURI> --send [--fee-usdt]
// --fee-usdt pays gas in USD₮ via Celo fee abstraction (CIP-64), so the wallet needs no CELO.
import { createPublicClient, http, encodeFunctionData, concat, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { ATTRIBUTION_CODE, dataSuffix, taggedWalletClient } from '../src/attribution.js';

export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'; // Celo mainnet (erc-8004/erc-8004-contracts README)
export const USDT_FEE_ADAPTER = '0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72'; // 18-dec fee-currency adapter for USD₮ (gas only)
export const ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'event', name: 'Registered', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'agentURI', type: 'string', indexed: false }, { name: 'owner', type: 'address', indexed: true }] },
];

// tagged: what lands on-chain (used for display and gas estimation). The send path
// passes the untagged calldata to a taggedWalletClient, which appends the tag once.
export function registerCalldata(agentURI, { tagged = true } = {}) {
  const data = encodeFunctionData({ abi: ABI, functionName: 'register', args: [agentURI] });
  return tagged ? concat([data, dataSuffix()]) : data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const uri = args.find(a => !a.startsWith('--'));
  if (!uri) { console.error('usage: node scripts/register-agent.js <agentURI> [--send] [--fee-usdt]'); process.exit(2); }
  const pub = createPublicClient({ chain: celo, transport: http(process.env.CELO_RPC || 'https://forno.celo.org') });
  const data = registerCalldata(uri);
  const from = process.env.AGENT_PRIVATE_KEY ? privateKeyToAccount(process.env.AGENT_PRIVATE_KEY).address : process.env.AGENT_ADDRESS;
  console.log(JSON.stringify({ registry: IDENTITY_REGISTRY, attribution_code: ATTRIBUTION_CODE, from, calldata_bytes: (data.length - 2) / 2 }));
  if (from) console.log('gas estimate:', String(await pub.estimateGas({ account: from, to: IDENTITY_REGISTRY, data })));
  if (!args.includes('--send')) { console.log('dry run: nothing sent'); process.exit(0); }
  const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
  const wallet = taggedWalletClient({ account, chain: celo, transport: http(process.env.CELO_RPC || 'https://forno.celo.org') });
  const hash = await wallet.sendTransaction({ to: IDENTITY_REGISTRY, data: registerCalldata(uri, { tagged: false }), ...(args.includes('--fee-usdt') ? { feeCurrency: USDT_FEE_ADAPTER } : {}) });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  const ev = parseEventLogs({ abi: ABI, logs: rcpt.logs, eventName: 'Registered' })[0];
  console.log(JSON.stringify({ tx: hash, status: rcpt.status, agentId: ev ? String(ev.args.agentId) : null, agentRegistry: `eip155:42220:${IDENTITY_REGISTRY}` }));
}
