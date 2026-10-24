import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { generatePrivateKey } from 'viem/accounts';
import { fromDataSuffix } from '@celo/attribution-tags';
import { custom, parseTransaction } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { createApp, rampUrl, registrationFile } from '../src/app.js';
import { ASSETS, toBaseUnits, x402Routes } from '../src/pricing.js';
import { ATTRIBUTION_CODE, taggedWalletClient } from '../src/attribution.js';
import { registerCalldata } from '../scripts/register-agent.js';
import { makePayFetch } from '../scripts/pay.js';

const PAY_TO = '0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1';
const supported = JSON.parse(readFileSync(new URL('../src/supported.celo.json', import.meta.url)));
const decode = h => JSON.parse(Buffer.from(h, 'base64').toString());

function mockFacilitator() {
  return {
    getSupported: vi.fn(async () => ({ kinds: supported.kinds, extensions: supported.extensions || [], signers: supported.signers || {} })),
    verify: vi.fn(async (p) => ({ isValid: true, payer: p.payload.authorization?.from })),
    settle: vi.fn(async (p, r) => ({ success: true, transaction: '0x' + 'ab'.repeat(32), network: r.network, payer: p.payload.authorization?.from })),
  };
}
const makeApp = (fac = mockFacilitator(), fetchImpl) => ({ fac, app: createApp({ payTo: PAY_TO, facilitatorClient: fac, fetchImpl }) });

describe('pricing', () => {
  it('converts human prices to base units exactly', () => {
    expect(toBaseUnits('15', 18)).toBe('15000000000000000000');
    expect(toBaseUnits('0.01', 6)).toBe('10000');
  });
  it('wARS routes are Permit2 with gas sponsoring declared', () => {
    const r = x402Routes(PAY_TO)['GET /ar/dolar'];
    expect(r.accepts[0].price.asset).toBe(ASSETS.wARS.address);
    expect(r.accepts[0].price.extra.assetTransferMethod).toBe('permit2');
    expect(r.extensions.eip2612GasSponsoring).toBeTruthy();
  });
});

describe('free routes', () => {
  it('describes routes and prices', async () => {
    const { app } = makeApp();
    const j = await (await app.request('http://x/')).json();
    expect(j.payTo).toBe(PAY_TO); expect(j.routes).toHaveLength(5); expect(j.network).toBe('eip155:42220');
  });
  it('builds a Ripio on-ramp link for wARS on Celo', async () => {
    expect(rampUrl({ address: PAY_TO, amount: 5000 })).toBe(`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=5000&address=${PAY_TO}`);
    const { app } = makeApp();
    expect((await app.request('http://x/ramp?address=0xnope')).status).toBe(400);
  });
  it('serves an ERC-8004 registration file', () => {
    const f = registrationFile('https://h/celo', { agentId: 7, registry: 'eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' });
    expect(f.type).toMatch(/eip-8004#registration-v1/); expect(f.registrations[0].agentId).toBe(7); expect(f.x402Support).toBe(true);
  });
});

describe('payment gate', () => {
  it('rejects bad input for free before asking for payment', async () => {
    const { app, fac } = makeApp();
    const r = await app.request('http://x/ar/cbu');
    expect(r.status).toBe(400); expect((await r.json()).charged).toBe(false); expect(fac.verify).not.toHaveBeenCalled();
  });
  it('answers 402 with wARS first, then USDC and USDT', async () => {
    const { app } = makeApp();
    const r = await app.request('http://x/ar/cuit?cuit=20123456786');
    expect(r.status).toBe(402);
    const pr = decode(r.headers.get('payment-required'));
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts.map(a => a.asset)).toEqual([ASSETS.wARS.address, ASSETS.USDC.address, ASSETS.USDT.address]);
    expect(pr.accepts[0].amount).toBe('10000000000000000000');
    expect(pr.extensions.eip2612GasSponsoring).toBeTruthy();
  });
  it('a signed USDC payment is verified, served and settled (mock facilitator)', async () => {
    const { app, fac } = makeApp();
    const { payFetch } = makePayFetch({ privateKey: generatePrivateKey(), asset: 'USDC', baseFetch: (i, init) => app.fetch(new Request(i, init)) });
    const r = await payFetch('http://x/ar/cuit?cuit=20-12345678-6');
    expect(r.status).toBe(200);
    expect((await r.json()).valid).toBe(true);
    expect(fac.verify).toHaveBeenCalledTimes(1); expect(fac.settle).toHaveBeenCalledTimes(1);
    expect(decode(r.headers.get('payment-response')).transaction).toMatch(/^0x/);
  });
  it('does not settle when the upstream source fails after payment verification', async () => {
    const { app, fac } = makeApp(undefined, async () => new Response('down', { status: 503 }));
    const { payFetch } = makePayFetch({ privateKey: generatePrivateKey(), asset: 'USDC', baseFetch: (i, init) => app.fetch(new Request(i, init)) });
    const r = await payFetch('http://x/ar/dolar?casa=blue');
    expect(r.status).toBe(502); expect(fac.settle).not.toHaveBeenCalled();
  });
});

describe('attribution', () => {
  it('uses the code issued at hackathon enrollment', () => expect(ATTRIBUTION_CODE).toBe('celo_85d42ed6ebcf'));
  it('wallet client tags every tx exactly once', async () => {
    const sent = [];
    const transport = custom({ request: async ({ method, params }) => {
      if (method === 'eth_sendRawTransaction') { sent.push(params[0]); return '0x' + '11'.repeat(32); }
      if (method === 'eth_chainId') return '0xa4ec';
      throw new Error('unexpected ' + method);
    } });
    const w = taggedWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: celo, transport });
    const fields = { nonce: 0, gas: 100000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, chainId: 42220 };
    await w.sendTransaction({ to: PAY_TO, data: '0x1234', ...fields });
    await w.sendTransaction({ to: PAY_TO, data: registerCalldata('https://example.com/a.json'), ...fields }); // already tagged: no double tag
    for (const raw of sent) {
      const input = parseTransaction(raw).data;
      expect(fromDataSuffix(input)).toEqual({ codes: [ATTRIBUTION_CODE], schemaId: 0 });
      expect(input.split('80218021802180218021802180218021').length - 1).toBe(1);
    }
  });
  it('402 routes declare the builder-code app code', () => {
    for (const r of Object.values(x402Routes(PAY_TO))) expect(r.extensions['builder-code'].info).toEqual({ a: ATTRIBUTION_CODE });
  });
  it('ERC-8004 register calldata carries the ERC-8021 tag', () => {
    const tag = fromDataSuffix(registerCalldata('https://example.com/agent.json'));
    expect(tag.codes).toContain(ATTRIBUTION_CODE);
  });
});

// Opt-in: hits the real Celo mainnet facilitator /verify (open, no key, no money).
// A fresh wallet has no wARS, so the expected answer is a balance failure AFTER the
// Permit2 + EIP-2612 signatures were accepted - proof the wire format is right.
describe.runIf(process.env.LIVE === '1')('live Celo facilitator', () => {
  it('wARS payload reaches the transfer step', async () => {
    const app = createApp({ payTo: PAY_TO });
    let sig;
    const baseFetch = (i, init) => { const q = new Request(i, init); sig ||= q.headers.get('payment-signature'); return app.fetch(q); };
    const { payFetch } = makePayFetch({ privateKey: generatePrivateKey(), asset: 'wARS', baseFetch });
    await payFetch('http://x/ar/cuit?cuit=20123456786');
    const payload = decode(sig);
    const v = await (await fetch('https://api.x402.celo.org/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: payload.accepted }) })).json();
    expect(v.isValid).toBe(false);
    expect(`${v.invalidReason} ${v.invalidReasonDetails || ''}`).toMatch(/insufficient|TRANSFER_FROM_FAILED/);
  }, 60000);
});
