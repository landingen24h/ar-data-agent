// Builds examples/*.json honestly:
//   response   = output of src/agent.js run locally on this machine, with live upstream data
//                (the same code the paid route runs after payment). No payment is made.
//   live_unpaid = what https://landingen24h.com answers to the same request without payment (402 + x402 terms).
// Also saves the raw upstream answers as test fixtures so the tests run offline.
// Usage: node scripts/make-examples.mjs
import { writeFileSync } from 'node:fs';
import { runCapability, CAPABILITIES } from '../src/agent.js';

const LIVE = 'https://landingen24h.com';
const cases = [
  { capability: 'ar.dolar', request: {} },
  { capability: 'ar.feriados', request: { date: '2026-12-24', add_business_days: 3 } },
  { capability: 'web.audit', request: { url: 'https://example.com' } },
];
const ua = { 'user-agent': 'LandingEn24hAgent-examples/1.0 (+https://landingen24h.com/oss/landing-en-24h-agent/)' };

async function liveUnpaid(path, body) {
  const r = await fetch(LIVE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...ua }, body: JSON.stringify(body) });
  const j = await r.json();
  const h = r.headers.get('payment-required');
  const v2 = h ? JSON.parse(Buffer.from(h, 'base64').toString('utf8')) : null;
  return {
    url: LIVE + path, method: 'POST', status: r.status, x402Version: j.x402Version, error: j.error,
    accepts: (j.accepts || []).map(a => ({ scheme: a.scheme, network: a.network, maxAmountRequired: a.maxAmountRequired, asset: a.asset, payTo: a.payTo })),
    payment_required_header_v2: v2 && { x402Version: v2.x402Version, accepts: v2.accepts.map(a => ({ scheme: a.scheme, network: a.network, amount: a.amount, asset: a.asset, payTo: a.payTo })) },
  };
}

const now = new Date().toISOString();
for (const c of cases) {
  const res = await runCapability(c.capability, c.request);
  if (res.err) throw new Error(c.capability + ': ' + res.err);
  const ex = {
    capability: c.capability,
    route: CAPABILITIES[c.capability],
    request: c.request,
    response: res.o,
    how_produced: 'response: src/agent.js run locally (node scripts/make-examples.mjs) at ' + now + ' with live upstream data, the same function the paid route runs after a payment settles. No payment was made and nothing was invented. live_unpaid: the real answer of the production endpoint to the same request sent without payment.',
    live_unpaid: await liveUnpaid(CAPABILITIES[c.capability], c.request),
  };
  writeFileSync(new URL('../examples/' + c.capability.replace('.', '-') + '.json', import.meta.url), JSON.stringify(ex, null, 2) + '\n');
  console.log(c.capability, 'ok', ex.live_unpaid.status);
}

// raw upstream answers for offline tests
const up = {
  'dolarapi-dolares.json': 'https://dolarapi.com/v1/dolares',
  'argentinadatos-feriados-2026.json': 'https://api.argentinadatos.com/v1/feriados/2026',
  'argentinadatos-feriados-2027.json': 'https://api.argentinadatos.com/v1/feriados/2027',
  'argentinadatos-inflacion.json': 'https://api.argentinadatos.com/v1/finanzas/indices/inflacion',
  'argentinadatos-inflacion-interanual.json': 'https://api.argentinadatos.com/v1/finanzas/indices/inflacionInteranual',
  'frankfurter-usd-eur.json': 'https://api.frankfurter.dev/v2/rate/usd/eur',
};
for (const [f, u] of Object.entries(up)) {
  const r = await fetch(u, { headers: { accept: 'application/json', ...ua } });
  if (!r.ok) { console.log('skip', f, r.status); continue; }
  writeFileSync(new URL('../test/fixtures/' + f, import.meta.url), JSON.stringify(await r.json(), null, 1) + '\n');
  console.log('fixture', f);
}
