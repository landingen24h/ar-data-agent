// Buyer CLI: pay one call in wARS (default), USDC, USDT or USAT on Celo mainnet.
//   BUYER_PRIVATE_KEY=0x... node scripts/pay.js "https://host/ar/dolar?casa=blue" [wARS|USDC|USDT|USAT]
// The payer needs only the token: the Celo facilitator pays gas and sponsors the
// Permit2 approval (EIP-2612), so no CELO is required.
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { ASSETS, CELO_MAINNET, ROUTES, toBaseUnits } from '../src/pricing.js';

export function makePayFetch({ privateKey, asset = 'wARS', rpcUrl = 'https://forno.celo.org', baseFetch = fetch, maxWars = '50' }) {
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client();
  // Permit2 assets are outside the library's default-asset table: opt in with an atomic cap.
  client.setSpendControls({
    allowedAssets: [{ network: CELO_MAINNET, asset: ASSETS.wARS.address, maxAmountPerPayment: toBaseUnits(maxWars, 18) }],
    maxAmountPerPayment: '$0.05',
  });
  // Only accept the asset we asked for.
  client.registerPolicy((_v, reqs) => reqs.filter(r => r.asset.toLowerCase() === ASSETS[asset].address.toLowerCase()));
  client.register('eip155:*', new ExactEvmScheme(account, { rpcUrl }));
  return { payFetch: wrapFetchWithPayment(baseFetch, client), account };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, asset = 'wARS'] = process.argv.slice(2);
  if (!url || !process.env.BUYER_PRIVATE_KEY) { console.error('usage: BUYER_PRIVATE_KEY=0x.. node scripts/pay.js <url> [wARS|USDC|USDT|USAT]'); process.exit(2); }
  const { payFetch, account } = makePayFetch({ privateKey: process.env.BUYER_PRIVATE_KEY, asset });
  console.error(`payer ${account.address}, asset ${asset}`);
  const res = await payFetch(url);
  const pr = res.headers.get('payment-response');
  console.log(JSON.stringify({ status: res.status, settlement: pr ? JSON.parse(Buffer.from(pr, 'base64').toString()) : null, body: await res.json().catch(() => null) }, null, 2));
}
void ROUTES;
