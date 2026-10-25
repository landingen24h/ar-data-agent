import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { createApp } from '../src/app.js';
import { ASSETS, x402Routes } from '../src/pricing.js';
import { BUY_SERVICE, briefPrompt, buyCompletion, dailyBudget, makeBuyer, taggedSigner } from '../src/buy.js';
import { makePayFetch } from '../scripts/pay.js';
import { quote } from '../scripts/buy-proof.js';

const PAY_TO = '0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1';
const supported = JSON.parse(readFileSync(new URL('../src/supported.celo.json', import.meta.url)));
const decode = h => JSON.parse(Buffer.from(h, 'base64').toString());
const mockFacilitator = () => ({
  getSupported: vi.fn(async () => ({ kinds: supported.kinds, extensions: supported.extensions || [], signers: supported.signers || {} })),
  verify: vi.fn(async (p) => ({ isValid: true, payer: p.payload.authorization?.from })),
  settle: vi.fn(async (p, r) => ({ success: true, transaction: '0x' + 'ab'.repeat(32), network: r.network, payer: p.payload.authorization?.from })),
});
const DOLAR = [
  { casa: 'oficial', nombre: 'Oficial', compra: 1500, venta: 1550, fechaActualizacion: '2026-10-25T10:00:00Z' },
  { casa: 'blue', nombre: 'Blue', compra: 1600, venta: 1620, fechaActualizacion: '2026-10-25T10:00:00Z' },
];
const dolarFetch = async () => new Response(JSON.stringify(DOLAR), { headers: { 'content-type': 'application/json' } });

// A stand-in for gateway.usebuy.ai speaking x402 v1 exactly like the live 402 (2026-10-25).
function mockGateway({ amount = BUY_SERVICE.priceAtomic, upstreamStatus = 200 } = {}) {
  const offer = sym => ({ scheme: 'exact', network: 'celo', maxAmountRequired: amount, resource: BUY_SERVICE.url, description: 'Chat completion', mimeType: 'application/json', payTo: BUY_SERVICE.payTo, maxTimeoutSeconds: 60, asset: ASSETS[sym].address, extra: { ...ASSETS[sym].extra } });
  const calls = [];
  const fetchImpl = vi.fn(async (input, init = {}) => {
    const req = new Request(input, init);
    const xp = req.headers.get('x-payment');
    calls.push({ url: req.url, payment: xp ? decode(xp) : null, body: await req.clone().text() });
    if (!xp) return new Response(JSON.stringify({ x402Version: 1, accepts: ['USDC', 'USDT', 'USAT'].map(offer), error: 'payment_required' }), { status: 402, headers: { 'content-type': 'application/json' } });
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: '0x' + 'cd'.repeat(32), network: 'celo' })).toString('base64');
    if (upstreamStatus !== 200) return new Response(JSON.stringify({ error: 'boom' }), { status: upstreamStatus, headers: { 'x-payment-response': receipt } });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'El oficial cotiza a 1550 y el blue a 1620, una brecha de 4,5%.' } }], usage: { total_tokens: 50 } }), { headers: { 'content-type': 'application/json', 'x-payment-response': receipt } });
  });
  return { fetchImpl, calls };
}

describe('USA₮ accepted on paid routes', () => {
  it('every paid route offers USA₮ with the facilitator EIP-712 domain', () => {
    for (const r of Object.values(x402Routes(PAY_TO))) {
      const usat = r.accepts.find(a => a.price.asset === ASSETS.USAT.address);
      expect(usat.price.amount).toBe('10000');
      expect(usat.price.extra).toEqual({ name: 'Tether America USD', version: '1' });
    }
  });
  it('USA₮ address and domain match the Celo facilitator /supported snapshot', () => {
    const a = supported.kinds[0].extra.supportedAssets.find(x => x.symbol === 'USAT');
    expect(a.asset).toBe(ASSETS.USAT.address); expect(a.decimals).toBe(6); expect(a.name).toBe('Tether America USD'); expect(a.assetTransferMethod).toBe('eip3009');
  });
  it('a signed USA₮ payment is verified, served and settled (mock facilitator)', async () => {
    const fac = mockFacilitator();
    const app = createApp({ payTo: PAY_TO, facilitatorClient: fac });
    const { payFetch } = makePayFetch({ privateKey: generatePrivateKey(), asset: 'USAT', baseFetch: (i, init) => app.fetch(new Request(i, init)) });
    const r = await payFetch('http://x/ar/cuit?cuit=20-12345678-6');
    expect(r.status).toBe(200);
    const req = fac.verify.mock.calls[0][1];
    expect(req.asset).toBe(ASSETS.USAT.address); expect(req.amount).toBe('10000');
    expect(fac.settle).toHaveBeenCalledTimes(1);
  });
});

describe('Build with buy (upstream purchase, flagged)', () => {
  it('is off by default: no /ar/brief route, nothing listed as bought', async () => {
    const app = createApp({ payTo: PAY_TO, facilitatorClient: mockFacilitator() });
    expect((await app.request('http://x/ar/brief')).status).toBe(404);
    const j = await (await app.request('http://x/')).json();
    expect(j.routes.map(r => r.url)).not.toContain('http://x/ar/brief'); expect(j.buys).toEqual([]);
    expect(Object.keys(x402Routes(PAY_TO))).not.toContain('GET /ar/brief');
  });
  it('enabled without a key stays off', async () => {
    const app = createApp({ payTo: PAY_TO, facilitatorClient: mockFacilitator(), buy: { enabled: true } });
    expect((await app.request('http://x/ar/brief')).status).toBe(404);
  });
  it('signs a USA₮ EIP-3009 authorization for exactly the quoted 0.01 to the Buy gateway', async () => {
    const pk = generatePrivateKey(); const acct = privateKeyToAccount(pk);
    const gw = mockGateway();
    const { payFetch } = makeBuyer({ privateKey: pk, asset: 'USAT', baseFetch: gw.fetchImpl });
    const r = await buyCompletion(payFetch, briefPrompt({ quotes: DOLAR.map(q => ({ ...q, updated_at: q.fechaActualizacion })) }, 'es'));
    expect(r.ok).toBe(true); expect(r.text).toMatch(/brecha/); expect(r.receipt.transaction).toMatch(/^0x/);
    const paid = gw.calls.find(c => c.payment);
    expect(paid.payment.x402Version).toBe(1); expect(paid.payment.network).toBe('celo');
    const auth = paid.payment.payload.authorization;
    expect(auth.to.toLowerCase()).toBe(BUY_SERVICE.payTo.toLowerCase()); expect(auth.value).toBe('10000'); expect(auth.from).toBe(acct.address);
    const body = JSON.parse(paid.body);
    expect(body).toMatchObject({ model: 'maximo-atlas-1.3', max_tokens: 256 });
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature']);
    // signature recovers to our account under the USA₮ token domain
    const signer = await recoverTypedDataAddress({
      domain: { name: 'Tether America USD', version: '1', chainId: 42220, verifyingContract: ASSETS.USAT.address },
      types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
      primaryType: 'TransferWithAuthorization',
      message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) },
      signature: paid.payment.payload.signature,
    });
    expect(signer).toBe(acct.address);
  });
  it('refuses to pay a quote above the cap (nothing signed)', async () => {
    const gw = mockGateway({ amount: '20000' });
    const { payFetch } = makeBuyer({ privateKey: generatePrivateKey(), asset: 'USAT', baseFetch: gw.fetchImpl });
    await expect(buyCompletion(payFetch, [{ role: 'user', content: 'x' }])).rejects.toThrow();
    expect(gw.calls.some(c => c.payment)).toBe(false);
  });
  it('the buyer signer is the attribution-tagged wallet client', () => {
    const s = taggedSigner(privateKeyToAccount(generatePrivateKey()));
    expect(typeof s.wallet.sendTransaction).toBe('function'); expect(typeof s.signTypedData).toBe('function');
  });
  it('/ar/brief: caller pays us, we buy the completion, response carries the brief and upstream receipt', async () => {
    const fac = mockFacilitator(); const gw = mockGateway();
    const { payFetch: upstream } = makeBuyer({ privateKey: generatePrivateKey(), asset: 'USAT', baseFetch: gw.fetchImpl });
    const app = createApp({ payTo: PAY_TO, facilitatorClient: fac, fetchImpl: dolarFetch, buy: { enabled: true, payFetch: upstream, asset: 'USAT' } });
    const r402 = await app.request('http://x/ar/brief?lang=es');
    expect(r402.status).toBe(402);
    const pr = decode(r402.headers.get('payment-required'));
    expect(pr.accepts[0].amount).toBe('45000000000000000000'); expect(pr.accepts.find(a => a.asset === ASSETS.USAT.address).amount).toBe('30000');
    const { payFetch } = makePayFetch({ privateKey: generatePrivateKey(), asset: 'USDC', baseFetch: (i, init) => app.fetch(new Request(i, init)) });
    const r = await payFetch('http://x/ar/brief?lang=es');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.brief).toMatch(/brecha/); expect(j.generated_by.upstream_receipt.transaction).toMatch(/^0x/); expect(j.data.brecha_blue_vs_oficial_pct).toBe(4.52);
    expect(fac.settle).toHaveBeenCalledTimes(1);
    const desc = await (await app.request('http://x/')).json();
    expect(desc.buys[0].url).toBe(BUY_SERVICE.url);
  });
  it('/ar/brief: upstream failure means the caller is NOT charged', async () => {
    const fac = mockFacilitator(); const gw = mockGateway({ upstreamStatus: 500 });
    const { payFetch: upstream } = makeBuyer({ privateKey: generatePrivateKey(), asset: 'USAT', baseFetch: gw.fetchImpl });
    const app = createApp({ payTo: PAY_TO, facilitatorClient: fac, fetchImpl: dolarFetch, buy: { enabled: true, payFetch: upstream } });
    const { payFetch } = makePayFetch({ privateKey: generatePrivateKey(), asset: 'USDC', baseFetch: (i, init) => app.fetch(new Request(i, init)) });
    const r = await payFetch('http://x/ar/brief');
    expect(r.status).toBe(502); expect(fac.settle).not.toHaveBeenCalled();
  });
  it('/ar/brief: bad lang is rejected free, before any payment', async () => {
    const fac = mockFacilitator();
    const app = createApp({ payTo: PAY_TO, facilitatorClient: fac, buy: { enabled: true, payFetch: vi.fn() } });
    const r = await app.request('http://x/ar/brief?lang=fr');
    expect(r.status).toBe(400); expect(fac.verify).not.toHaveBeenCalled();
  });
  it('daily budget caps upstream purchases', () => {
    const b = dailyBudget(2); expect(b.take()).toBe(true); expect(b.take()).toBe(true); expect(b.take()).toBe(false);
  });
  it('dry-run quote reads the 402 without signing', async () => {
    const gw = mockGateway();
    const q = await quote(gw.fetchImpl);
    expect(q.status).toBe(402); expect(q.offers.map(o => o.amount)).toEqual(['10000', '10000', '10000']);
    expect(gw.calls.every(c => !c.payment)).toBe(true);
  });
});
