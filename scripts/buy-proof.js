// Proof of "Build with buy": the agent pays ONE Cencori completion through the Buy gateway.
//   node scripts/buy-proof.js                      -> dry run: shows the live 402 quote, signs nothing
//   BUY_PRIVATE_KEY=0x.. node scripts/buy-proof.js --pay [USAT|USDT|USDC]
// Cost: exactly one payment of the quoted amount (0.01 USD as of 2026-10-25); the payer pays no gas.
import { BUY_SERVICE, briefPrompt, buyCompletion, makeBuyer } from '../src/buy.js';
import { getDolar } from '../src/data.js';

export async function quote(baseFetch = fetch) {
  const body = JSON.stringify({ model: BUY_SERVICE.model, max_tokens: BUY_SERVICE.maxTokens, messages: [{ role: 'user', content: 'quote' }] });
  const r = await baseFetch(BUY_SERVICE.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, offers: (j.accepts || []).map(a => ({ network: a.network, asset: a.asset, amount: a.maxAmountRequired ?? a.amount, payTo: a.payTo, name: a.extra?.name })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pay = process.argv.includes('--pay');
  const asset = process.argv.slice(2).find(a => /^(USAT|USDT|USDC)$/.test(a)) || 'USAT';
  console.log(JSON.stringify({ service: BUY_SERVICE.url, quote: await quote() }, null, 2));
  if (!pay) { console.log('dry run: nothing signed. Add --pay to buy one completion.'); process.exit(0); }
  if (!process.env.BUY_PRIVATE_KEY) { console.error('BUY_PRIVATE_KEY required'); process.exit(2); }
  const { payFetch, address } = makeBuyer({ privateKey: process.env.BUY_PRIVATE_KEY, asset });
  console.error(`payer ${address}, asset ${asset}, cap ${BUY_SERVICE.priceAtomic} atomic`);
  const dol = await getDolar({ casa: 'all' });
  if (!dol.ok) { console.error('dolar source down; not buying'); process.exit(1); }
  const r = await buyCompletion(payFetch, briefPrompt(dol.data, 'es'));
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
