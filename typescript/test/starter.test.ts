import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, listOffer, validateOffer, toAtomic } from '../src/index.ts';
import type { Facilitator, PaymentPayload, PaymentRequirements } from '../src/index.ts';

const PAY_TO = '0x1111111111111111111111111111111111111111';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = (s: string) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const payment = (over: Partial<PaymentPayload> = {}): PaymentPayload => ({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: 'sig', authorization: {} }, ...over });

function fakeFacilitator(opts: { valid?: boolean; settled?: boolean; throwOn?: 'verify' | 'settle' } = {}) {
  const calls: string[] = [];
  const seen: PaymentRequirements[] = [];
  const f: Facilitator = {
    async verify(_p, req) { calls.push('verify'); seen.push(req); if (opts.throwOn === 'verify') throw new Error('down'); return opts.valid === false ? { isValid: false, invalidReason: 'insufficient_funds' } : { isValid: true, payer: '0xpayer' }; },
    async settle(_p, req) { calls.push('settle'); seen.push(req); if (opts.throwOn === 'settle') throw new Error('down'); return opts.settled === false ? { success: false, transaction: '', network: req.network, errorReason: 'reverted' } : { success: true, transaction: '0xabc', network: req.network }; },
  };
  return { f, calls, seen };
}

function app(fac: Facilitator, work?: () => unknown, network: 'base' | 'base-sepolia' = 'base-sepolia') {
  return createApp({ price: '0.01', payTo: PAY_TO, network, facilitator: fac, description: 'test route', work: work as any });
}

test('A1 an unpaid call answers 402 with valid x402 payment requirements', async (t) => {
  await t.test('base sepolia', async () => {
    const r = await app(fakeFacilitator().f).fetch(new Request('https://agent.example/paid'));
    assert.equal(r.status, 402);
    const body = await r.json();
    assert.equal(body.x402Version, 1);
    assert.equal(typeof body.error, 'string');
    assert.equal(body.accepts.length, 1);
    const a = body.accepts[0];
    assert.deepEqual(Object.keys(a).sort(), ['asset', 'description', 'extra', 'maxAmountRequired', 'maxTimeoutSeconds', 'mimeType', 'network', 'payTo', 'resource', 'scheme'].sort());
    assert.equal(a.scheme, 'exact');
    assert.equal(a.network, 'base-sepolia');
    assert.equal(a.maxAmountRequired, '10000');
    assert.equal(a.payTo, PAY_TO);
    assert.equal(a.resource, 'https://agent.example/paid');
    assert.equal(a.mimeType, 'application/json');
    assert.equal(a.asset, '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    assert.ok(a.maxTimeoutSeconds > 0);
  });
  await t.test('base mainnet uses the Base USDC contract', async () => {
    const r = await app(fakeFacilitator().f, undefined, 'base').fetch(new Request('https://agent.example/paid'));
    const a = (await r.json()).accepts[0];
    assert.equal(a.network, 'base');
    assert.equal(a.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });
  await t.test('price to atomic units', () => {
    assert.equal(toAtomic('0.01'), '10000');
    assert.equal(toAtomic('1'), '1000000');
    assert.equal(toAtomic('2.5'), '2500000');
    assert.equal(toAtomic('0.000001'), '1');
    for (const bad of ['0', '-1', '1e3', '0.0000001', 'abc', '']) assert.throws(() => toAtomic(bad), bad);
  });
  await t.test('health is free', async () => {
    const { f, calls } = fakeFacilitator();
    const r = await app(f).fetch(new Request('https://agent.example/health'));
    assert.equal(r.status, 200);
    assert.deepEqual(calls, []);
  });
  await t.test('bad config is refused', () => {
    assert.throws(() => createApp({ price: '0.01', payTo: 'nope', network: 'base', facilitator: fakeFacilitator().f }));
    assert.throws(() => createApp({ price: '0.01', payTo: PAY_TO, network: 'mainnet' as any, facilitator: fakeFacilitator().f }));
  });
});

test('A2 a paid call is verified, then settled, then answered 200 with X-PAYMENT-RESPONSE', async (t) => {
  await t.test('happy path, in order, work runs once', async () => {
    const { f, calls, seen } = fakeFacilitator();
    let worked = 0;
    const r = await app(f, () => { calls.push('work'); worked++; return { answer: 42 }; }).fetch(new Request('https://agent.example/paid', { headers: { 'X-PAYMENT': b64(payment()) } }));
    assert.equal(r.status, 200);
    assert.deepEqual(calls, ['verify', 'settle', 'work']);
    assert.equal(worked, 1);
    assert.equal(seen[0].maxAmountRequired, '10000');
    const body = await r.json();
    assert.deepEqual(body.result, { answer: 42 });
    const receipt = unb64(r.headers.get('x-payment-response')!);
    assert.equal(receipt.success, true);
    assert.equal(receipt.transaction, '0xabc');
    assert.equal(receipt.network, 'base-sepolia');
  });
  const failing: Array<[string, Parameters<typeof fakeFacilitator>[0], string[]]> = [
    ['verification fails', { valid: false }, ['verify']],
    ['settlement fails', { settled: false }, ['verify', 'settle']],
    ['verify throws', { throwOn: 'verify' }, ['verify']],
    ['settle throws', { throwOn: 'settle' }, ['verify', 'settle']],
  ];
  for (const [name, opts, expected] of failing) {
    await t.test(`${name}: 402 and no work`, async () => {
      const { f, calls } = fakeFacilitator(opts);
      let worked = 0;
      const r = await app(f, () => { worked++; }).fetch(new Request('https://agent.example/paid', { headers: { 'X-PAYMENT': b64(payment()) } }));
      assert.equal(r.status, 402);
      assert.equal(worked, 0);
      assert.deepEqual(calls, expected);
      assert.equal(r.headers.get('x-payment-response'), null);
      const body = await r.json();
      assert.equal(body.accepts.length, 1);
    });
  }
  await t.test('a malformed header, wrong version or wrong network never reaches the facilitator', async () => {
    for (const h of ['%%%', b64('x'), b64(payment({ x402Version: 2 })), b64(payment({ network: 'base' })), b64(payment({ scheme: 'upto' }))]) {
      const { f, calls } = fakeFacilitator();
      const r = await app(f).fetch(new Request('https://agent.example/paid', { headers: { 'X-PAYMENT': h } }));
      assert.equal(r.status, 402, h);
      assert.deepEqual(calls, []);
    }
  });
});

test('A3 the offer passes the LAX registry validation, with the Five Laws', async (t) => {
  await t.test('typescript/lax-offer.json', () => {
    const offer = JSON.parse(readFileSync(new URL('../lax-offer.json', import.meta.url), 'utf8'));
    assert.deepEqual(validateOffer(offer), []);
    assert.equal(offer.capabilities[0].pricing.model, 'per_call');
    assert.ok(offer.endpoint.startsWith('https://'));
  });
  await t.test('python/lax-offer.json', () => {
    const offer = JSON.parse(readFileSync(new URL('../../python/lax-offer.json', import.meta.url), 'utf8'));
    assert.deepEqual(validateOffer(offer), []);
  });
  await t.test('an offer without the Five Laws or with a bad price is refused', () => {
    const offer = JSON.parse(readFileSync(new URL('../lax-offer.json', import.meta.url), 'utf8'));
    assert.ok(validateOffer({ ...offer, constitutional_constraints: ['Harm Shield'] }).some((e) => e.includes('Five Laws')));
    const bad = structuredClone(offer); bad.capabilities[0].pricing.amount = '1e2';
    assert.ok(validateOffer(bad).some((e) => e.includes('amount')));
  });
});

test('A4 the listing script answers the 402, pays through the given function and returns the id, without logging a key', async (t) => {
  const offer = { name: 'x' };
  const terms = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '10000' }] };
  await t.test('version 2 terms in the header: PAYMENT-SIGNATURE', async () => {
    const sent: Array<Record<string, string>> = [];
    const fetchFake = async (_u: any, init: any) => {
      sent.push(init.headers);
      if (!init.headers['PAYMENT-SIGNATURE']) return new Response(JSON.stringify({ x402Version: 2, error: 'pay' }), { status: 402, headers: { 'payment-required': b64(terms) } });
      return new Response(JSON.stringify({ ok: true, id: 'lax-ext-1', transaction: '0xt' }), { status: 201 });
    };
    let paidWith: any = null;
    const logs: unknown[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    console.log = console.error = console.warn = console.info = (...a: unknown[]) => { logs.push(a); };
    try {
      const out = await listOffer({ offer, registryUrl: 'https://reg.example/registry/', fetch: fetchFake as any, pay: async (pr) => { paidWith = pr; return 'SIGNED-SECRET-VALUE'; } });
      assert.deepEqual(out, { id: 'lax-ext-1', transaction: '0xt' });
    } finally { Object.assign(console, orig); }
    assert.deepEqual(paidWith, terms);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]['PAYMENT-SIGNATURE'], 'SIGNED-SECRET-VALUE');
    assert.deepEqual(logs, []);
  });
  await t.test('version 1 terms in the body: X-PAYMENT', async () => {
    const fetchFake = async (_u: any, init: any) => init.headers['X-PAYMENT']
      ? new Response(JSON.stringify({ ok: true, id: 'lax-ext-2' }), { status: 200 })
      : new Response(JSON.stringify({ x402Version: 1, accepts: [{ scheme: 'exact' }] }), { status: 402 });
    const out = await listOffer({ offer, fetch: fetchFake as any, pay: async () => 'v1header' });
    assert.equal(out.id, 'lax-ext-2');
  });
  await t.test('a refused offer throws with the registry message and pays nothing', async () => {
    let paid = 0;
    const fetchFake = async () => new Response(JSON.stringify({ error: 'description must be 20 to 600 characters' }), { status: 400 });
    await assert.rejects(listOffer({ offer, fetch: fetchFake as any, pay: async () => { paid++; return 'x'; } }), /description must be/);
    assert.equal(paid, 0);
  });
});

test('A5 each starter answers 402 then a paid call on Base Sepolia', { todo: 'M2: live proof with the transaction hash in the README' }, () => {});
test('A6 the Python starter mirrors A1 to A4 with pytest tests', { todo: 'M2: checked by pytest in python/tests' }, () => {});
