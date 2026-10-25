// Tests A1 to A5. Run: npm test (node --test). Offline: upstreams and the facilitator are local stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPABILITIES, schemas, precheck, PAY_TO } from '../src/agent.js';
import { call, check, stubFacilitator, stubUpstream } from './helpers.js';

const VALID = {
  'landing.generate': { business_name: 'Plomeria Rapida', city: 'Buenos Aires', whatsapp: '5491122334455', services: ['Leak repair: no broken walls'], language: 'en' },
  'ar.cuit': { cuit: '20-12345678-6' },
  'ar.cbu': { cbu: '0070999003000412345671' },
  'ar.phone': { phone: '011 15 1234-5678' },
  'ar.dolar': { casa: 'all' },
  'ar.inflacion': { from: '2026-01', to: '2026-06', amount: 100000 },
  'ar.feriados': { date: '2026-12-24', add_business_days: 3 },
  'web.audit': { url: 'https://audit.example.org/' },
  'fx.rate': { from: 'USD', to: 'EUR', amount: 100 },
};
const INVALID = {
  'landing.generate': { tagline: 'no business name' },
  'ar.cuit': {},
  'ar.cbu': {},
  'ar.phone': { phone: '----' },
  'ar.dolar': { casa: 'euro' },
  'ar.inflacion': { from: '2026-13' },
  'ar.feriados': { date: '24/12/2026' },
  'web.audit': { url: 'ftp://example.com/file' },
  'fx.rate': { from: 'USD', to: 'EURO' },
};
const PRICE = { 'landing.generate': '250000', 'ar.cuit': '10000', 'ar.cbu': '10000', 'ar.phone': '10000', 'ar.dolar': '2000', 'ar.inflacion': '2000', 'ar.feriados': '2000', 'web.audit': '20000', 'fx.rate': '2000' };

test('A1 valid paid call returns output that matches the published output schema', async t => {
  const up = stubUpstream();
  t.after(up.restore);
  for (const [skill, path] of Object.entries(CAPABILITIES)) {
    const fac = stubFacilitator();
    const r = await call(path, { body: VALID[skill], paid: true, facilitator: fac });
    assert.equal(r.status, 200, skill + ' ' + JSON.stringify(r.json));
    assert.deepEqual(check(schemas(skill).output, r.json), [], skill);
    assert.deepEqual(fac.calls, { verify: 1, settle: 1 }, skill + ': verified and settled once');
    const receipt = JSON.parse(Buffer.from(r.headers.get('x-payment-response'), 'base64').toString());
    assert.equal(receipt.success, true);
  }
  // spot checks on real logic
  const fac = stubFacilitator();
  const fe = await call(CAPABILITIES['ar.feriados'], { body: VALID['ar.feriados'], paid: true, facilitator: fac });
  assert.equal(fe.json.date_check.is_holiday, false);
  assert.equal(fe.json.date_check.result_date, '2026-12-30'); // 25 Dec is a holiday, 26 and 27 are a weekend
  const cuit = await call(CAPABILITIES['ar.cuit'], { body: VALID['ar.cuit'], paid: true, facilitator: stubFacilitator() });
  assert.equal(cuit.json.valid, true);
  assert.equal(cuit.json.entity_type, 'person');
});

test('A2 invalid input is refused with 400 before the payment is verified or settled', async t => {
  const up = stubUpstream();
  t.after(up.restore);
  for (const [skill, path] of Object.entries(CAPABILITIES)) {
    const fac = stubFacilitator();
    const r = await call(path, { body: INVALID[skill], paid: true, facilitator: fac });
    assert.equal(r.status, 400, skill + ' ' + JSON.stringify(r.json));
    assert.equal(r.json.note, 'No payment was taken.');
    assert.ok(r.json.error, skill + ' names the error');
    assert.deepEqual(fac.calls, { verify: 0, settle: 0 }, skill + ': facilitator never called');
    assert.ok(precheck(skill, INVALID[skill]).err, skill + ' precheck refuses');
  }
  assert.equal(up.seen.length, 0, 'no upstream was fetched for invalid input');
  // broken JSON is refused the same way
  const fac = stubFacilitator();
  const res = await (await import('../src/agent.js')).default.fetch(new Request('https://landingen24h.com/api/x402/ar/cuit', { method: 'POST', headers: { 'x-payment': Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'base', payload: {} })).toString('base64') }, body: '{not json' }), { facilitator: fac });
  assert.equal(res.status, 400);
  assert.equal(fac.calls.verify, 0);
});

test('A3 unpaid call answers 402 with x402 terms in USDC on Base (same terms as production)', async () => {
  const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  for (const [skill, path] of Object.entries(CAPABILITIES)) {
    const fac = stubFacilitator();
    const r = await call(path, { body: VALID[skill], facilitator: fac });
    assert.equal(r.status, 402, skill);
    assert.equal(r.json.x402Version, 1);
    const base = r.json.accepts.find(a => a.network === 'base');
    assert.ok(base, skill + ' offers Base');
    assert.equal(base.scheme, 'exact');
    assert.equal(base.asset, BASE_USDC);
    assert.equal(base.payTo, PAY_TO);
    assert.equal(base.maxAmountRequired, PRICE[skill], skill + ' price');
    const v2 = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString());
    assert.equal(v2.x402Version, 2);
    assert.ok(v2.accepts.some(a => a.network === 'eip155:8453' && a.amount === PRICE[skill] && a.asset === BASE_USDC && a.payTo === PAY_TO));
    assert.deepEqual(fac.calls, { verify: 0, settle: 0 });
  }
  // the terms built by this module equal the ones the live endpoint returned (recorded in examples/)
  for (const f of ['ar-dolar', 'ar-feriados', 'web-audit']) {
    const ex = JSON.parse(readFileSync(new URL('../examples/' + f + '.json', import.meta.url), 'utf8'));
    const r = await call(ex.route, { body: ex.request });
    const mine = r.json.accepts.map(a => ({ scheme: a.scheme, network: a.network, maxAmountRequired: a.maxAmountRequired, asset: a.asset, payTo: a.payTo }));
    assert.equal(ex.live_unpaid.status, 402);
    assert.deepEqual(mine, ex.live_unpaid.accepts, f + ' matches production');
  }
});

test('A4 web.audit refuses private and local addresses before any charge or fetch', async t => {
  const up = stubUpstream();
  t.after(up.restore);
  const blocked = ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/', 'http://[::1]/', 'http://printer.local/', 'http://db.internal/', 'http://intranet/', 'https://example.com:8443/'];
  for (const url of blocked) {
    const fac = stubFacilitator();
    const r = await call(CAPABILITIES['web.audit'], { body: { url }, paid: true, facilitator: fac });
    assert.equal(r.status, 400, url + ' ' + JSON.stringify(r.json));
    assert.match(r.json.error, /host_not_allowed|port_not_allowed/);
    assert.deepEqual(fac.calls, { verify: 0, settle: 0 }, url);
  }
  assert.equal(up.seen.length, 0, 'nothing was fetched');
  // a public page that cannot be read: payment verified but never settled, so no charge
  const fac = stubFacilitator();
  const r = await call(CAPABILITIES['web.audit'], { body: { url: 'https://unreadable.example.org/' }, paid: true, facilitator: fac });
  assert.equal(r.status, 502);
  assert.equal(r.json.note, 'No payment was taken.');
  assert.deepEqual(fac.calls, { verify: 1, settle: 0 });
});

test('A5 out of scope requests are refused and never charged', async () => {
  const fac = stubFacilitator();
  for (const path of ['/api/x402/ar/dni', '/api/x402/person/lookup', '/api/x402/util/uuid', '/api/x402/trade']) {
    const r = await call(path, { body: { dni: '12345678' }, paid: true, facilitator: fac });
    assert.equal(r.status, 404, path);
    assert.equal(r.json.error, 'not_found');
  }
  const r2 = await call('/somewhere/else', { body: {}, paid: true, facilitator: fac });
  assert.equal(r2.status, 404);
  const r3 = await call(CAPABILITIES['ar.cuit'], { method: 'DELETE', facilitator: fac });
  assert.equal(r3.status, 405);
  // a payment on a network we do not accept gets the 402 terms again, not work
  const r4 = await call(CAPABILITIES['ar.cuit'], { body: VALID['ar.cuit'], paid: true, network: 'ethereum', facilitator: fac });
  assert.equal(r4.status, 402);
  assert.equal(r4.json.error, 'unsupported_scheme_or_network');
  assert.equal(precheck('crypto.trade', {}).err, 'unknown_capability');
  assert.deepEqual(fac.calls, { verify: 0, settle: 0 });
  // CUIT and CBU are checksum only: no owner lookup in the answer
  const ok = await call(CAPABILITIES['ar.cbu'], { body: VALID['ar.cbu'], paid: true, facilitator: stubFacilitator() });
  assert.ok(!('owner' in ok.json) && !('holder' in ok.json) && !('name' in ok.json));
  assert.match(ok.json.note, /does not confirm the account exists or its owner/);
});
