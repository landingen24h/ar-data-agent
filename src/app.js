// Hono app: free discovery routes + x402-paid Argentine data routes on Celo.
// Runs unchanged on Node (src/node.js) and Cloudflare Workers (src/worker.js).
import { Hono } from 'hono';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getAddress, isAddress } from 'viem';
import { ASSETS, CELO_MAINNET, FACILITATOR_MAINNET, routeTable, x402Routes } from './pricing.js';
import * as d from './data.js';
import { BUY_SERVICE, briefPrompt, buyCompletion, makeBuyer } from './buy.js';
import { memoryGuard, newToken, payerFromKey, paymentKey } from './guard.js';

const PAID = {
  '/ar/dolar': { parse: d.parseDolar, run: (i, f) => d.getDolar(i, f) },
  '/ar/inflacion': { parse: d.parseInflacion, run: (i, f) => d.getInflacion(i, f) },
  '/ar/feriados': { parse: q => d.parseFeriados(q), run: (i, f) => d.getFeriados(i, f) },
  '/ar/cuit': { parse: d.parseCuit, run: async i => ({ ok: true, data: d.validateCuit(i) }) },
  '/ar/cbu': { parse: d.parseCbu, run: async i => ({ ok: true, data: d.validateCbu(i) }) },
};

export function rampUrl({ address, amount = 10000, offramp = false }) {
  const u = new URL(offramp ? 'https://ramp.ripio.com/offramp' : 'https://ramp.ripio.com/');
  u.searchParams.set('country', 'AR'); u.searchParams.set('chain', '42220'); u.searchParams.set('token', 'WARS');
  u.searchParams.set('amount', String(amount));
  if (address) u.searchParams.set('address', getAddress(address));
  return u.toString();
}

/**
 * @param {object} cfg
 * @param {string} cfg.payTo           seller wallet that receives wARS/USDC/USDT
 * @param {string} [cfg.apiKey]        Celo facilitator key (X402_API_KEY); settle needs it
 * @param {string} [cfg.facilitatorUrl]
 * @param {string} [cfg.basePath]      mount prefix, e.g. "/celo"
 * @param {string} [cfg.publicUrl]     absolute origin used in discovery docs
 * @param {object} [cfg.agent]         { agentId, registry } once registered (ERC-8004)
 * @param {typeof fetch} [cfg.fetchImpl] upstream fetch (tests inject a mock)
 * @param {object} [cfg.facilitatorClient] override (tests)
 * @param {object} [cfg.supported]   static /supported snapshot (Workers)
 * @param {object} [cfg.buy]         "Build with buy" (off by default): { enabled, privateKey | payFetch, asset, maxCallsPerDay }
 */
export function createApp(cfg) {
  if (!cfg || !isAddress(cfg.payTo || '')) throw new Error('payTo address required');
  const payTo = getAddress(cfg.payTo);
  const base = cfg.basePath || '';
  const network = cfg.network || CELO_MAINNET;
  let facilitator = cfg.facilitatorClient || new HTTPFacilitatorClient({
    url: cfg.facilitatorUrl || FACILITATOR_MAINNET,
    createAuthHeaders: async () => {
      const h = cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {};
      return { verify: h, settle: h, supported: h };
    },
  });
  if (cfg.supported) {
    // Workers: a pending fetch started in one request cannot be awaited from another,
    // so serve /supported from a bundled snapshot and keep only verify/settle live.
    const live = facilitator, snap = cfg.supported;
    facilitator = { verify: (p, r) => live.verify(p, r), settle: (p, r) => live.settle(p, r), getSupported: async () => ({ kinds: snap.kinds, extensions: snap.extensions || [], signers: snap.signers || {} }) };
  }
  // ---- optional upstream purchases (flag) ----
  let buyer = null;
  // Needs a replay lock + global budget (cfg.buy.guard, see src/guard.js). Without one it stays off,
  // unless cfg.buy.localGuard is set (single process only: local Node server and tests).
  const guard = cfg.buy && (cfg.buy.guard || (cfg.buy.localGuard ? memoryGuard(Number(cfg.buy.maxCallsPerDay) || 20) : null));
  if (cfg.buy && cfg.buy.enabled && guard && (cfg.buy.payFetch || cfg.buy.privateKey)) {
    const pf = cfg.buy.payFetch || makeBuyer({ privateKey: cfg.buy.privateKey, asset: cfg.buy.asset || 'USAT' }).payFetch;
    buyer = { payFetch: pf, asset: cfg.buy.asset || 'USAT', guard };
  }
  const origin = c => cfg.publicUrl || new URL(c.req.url).origin;
  const briefBody = (lang, b, data) => ({ lang, brief: b.text, data, generated_by: { service: BUY_SERVICE.name, model: BUY_SERVICE.model, paid_with: buyer.asset, upstream_receipt: b.receipt }, note: 'AI-written summary of the quotes included below; not financial advice.' });
  // The caller already paid: give a one-time retry token instead of leaving them with nothing.
  const briefFailed = async (lang, err, c, token) => {
    const t = token || newToken();
    const ok = await buyer.guard.credit(t);
    const retry = ok && c ? `${origin(c)}${base}/ar/brief/retry?token=${t}&lang=${lang}` : null;
    return { ok: false, error: `upstream_${err}`, status: 502, charged: true, retry_url: retry, retry_note: retry ? 'Free, one use, valid 48 h.' : undefined };
  };
  const PAID_ALL = buyer ? { ...PAID, '/ar/brief': {
    parse: q => { const lang = String(q.lang || 'es').toLowerCase(); return ['es', 'en'].includes(lang) ? { ok: true, input: { lang } } : { ok: false, error: 'lang_must_be_es_or_en', status: 400 }; },
    // Runs after the caller's payment is SETTLED (upfront flow). Replay lock and budget unit were
    // taken by the pre-settle gate below, so here we only buy.
    run: async (i, f, c) => {
      if (c) c.set('briefRan', true);
      const dol = await d.getDolar({ casa: 'all' }, f);
      const b = dol.ok ? await buyCompletion(buyer.payFetch, briefPrompt(dol.data, i.lang)) : { ok: false, error: 'data_source' };
      if (!b.ok) return briefFailed(i.lang, b.error, c);
      return { ok: true, data: briefBody(i.lang, b, dol.data) };
    },
  } } : PAID;
  const ROUTES = routeTable(!!buyer);

  const server = new x402ResourceServer(facilitator);
  server.register('eip155:*', new ExactEvmScheme());
  server.registerExtension(bazaarResourceServerExtension); // fills the HTTP method into each route's bazaar discovery info

  const app = new Hono();

  // ---- free routes ----
  const describe = c => ({
    name: 'AR Data Agent',
    description: 'Pay-per-call Argentine data for agents and people, priced in pesos (wARS) on Celo via x402. No accounts, no API keys: pay per request, gasless for the payer.',
    network, payTo,
    facilitator: cfg.facilitatorUrl || FACILITATOR_MAINNET,
    assets: Object.fromEntries(Object.entries(ASSETS).map(([k, v]) => [k, v.address])),
    routes: Object.entries(ROUTES).map(([p, r]) => ({ method: 'GET', url: origin(c) + base + p, price_wars: r.wars, price_usd_alt: r.usd, description: r.description, query: r.query })),
    get_wars: origin(c) + base + '/ramp?address=0xYourWallet&amount=10000',
    agent: cfg.agent || null,
    buys: buyer ? [{ service: BUY_SERVICE.name, url: BUY_SERVICE.url, price_usd: '0.01', asset: buyer.asset, used_by: base + '/ar/brief' }] : [],
    source: 'https://github.com/landingen24h/ar-data-agent',
  });
  // Browsers get a readable catalog; agents and curl keep the JSON (also forced with ?format=json).
  app.get(base + '/', c => {
    const d = describe(c);
    const wantsHtml = (c.req.header('accept') || '').includes('text/html') && c.req.query('format') !== 'json';
    return wantsHtml ? c.html(catalogHtml(d, origin(c) + base)) : c.json(d);
  });
  app.get(base + '/health', c => c.json({ ok: true }));
  app.get(base + '/prices', c => c.json(describe(c).routes));
  app.get(base + '/ramp', c => {
    const address = c.req.query('address');
    const amount = Number(c.req.query('amount') || 10000);
    if (address && !isAddress(address)) return c.json({ error: 'invalid_address' }, 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return c.json({ error: 'amount_must_be_1_to_10000000_ars' }, 400);
    const off = c.req.query('offramp') === '1';
    return c.json({ url: rampUrl({ address, amount, offramp: off }), provider: 'Ripio (ramp.ripio.com)', token: 'wARS', chain: 'Celo (42220)', note: off ? 'Sell wARS for ARS to a local bank account.' : 'Buy wARS with ARS and receive it on Celo at the given address.' });
  });
  app.get(base + '/.well-known/agent-registration.json', c => c.json(registrationFile(origin(c) + base, cfg.agent)));

  // ---- input validation BEFORE payment: a bad request is never charged ----
  for (const p of Object.keys(PAID_ALL)) {
    app.use(base + p, async (c, next) => {
      const parsed = PAID_ALL[p].parse(c.req.query());
      if (!parsed.ok) return c.json({ error: parsed.error, charged: false }, parsed.status);
      c.set('input', parsed.input);
      await next();
    });
  }

  if (buyer) {
    // ---- /ar/brief pre-settle gate: replay lock + budget unit BEFORE the caller is charged ----
    app.use(base + '/ar/brief', async (c, next) => {
      const hdr = c.req.header('payment-signature') || c.req.header('x-payment');
      if (!hdr) return next(); // no payment yet: the x402 middleware answers 402
      const key = paymentKey(hdr);
      if (!key) return c.json({ error: 'payment_key_unreadable', charged: false }, 400);
      if (!(await buyer.guard.claim(key))) return c.json({ error: 'payment_already_used', charged: false }, 409);
      const payer = payerFromKey(key);
      if (!(await buyer.guard.take(payer))) return c.json({ error: 'brief_daily_budget_reached', charged: false }, 503); // global + per-payer quota
      await next();
      if (!c.get('briefRan')) await buyer.guard.release(payer); // settle failed: nothing bought, hand the unit back
    });
    // ---- free one-time retry for a paid call whose upstream purchase failed ----
    app.get(base + '/ar/brief/retry', async c => {
      const token = c.req.query('token'); const lang = String(c.req.query('lang') || 'es').toLowerCase();
      if (!['es', 'en'].includes(lang)) return c.json({ error: 'lang_must_be_es_or_en' }, 400);
      if (!(await buyer.guard.redeem(token))) return c.json({ error: 'retry_token_invalid_or_used' }, 403);
      const dol = await d.getDolar({ casa: 'all' }, cfg.fetchImpl);
      const b = dol.ok ? await buyCompletion(buyer.payFetch, briefPrompt(dol.data, lang)) : { ok: false, error: 'data_source' };
      if (!b.ok) { const r = await briefFailed(lang, b.error, c, token); return c.json({ error: r.error, retry_url: r.retry_url }, 502); }
      return c.json(briefBody(lang, b, dol.data));
    });
  }
  // ---- x402 payment gate (verify -> handler -> settle only if handler < 400; /ar/brief settles first) ----
  app.use(paymentMiddleware(x402Routes(payTo, { basePath: base, network, buy: !!buyer }), server, undefined, undefined, cfg.syncFacilitatorOnStart ?? true));

  for (const [p, h] of Object.entries(PAID_ALL)) {
    app.get(base + p, async c => {
      const r = await h.run(c.get('input'), cfg.fetchImpl, c);
      if (!r.ok) return c.json({ error: r.error, charged: r.charged === true, ...(r.retry_url ? { retry_url: r.retry_url, retry_note: r.retry_note } : {}) }, r.status);
      return c.json(r.data);
    });
  }
  return app;
}

// ERC-8004 registration file (served at /.well-known/agent-registration.json and
// pointed to by the on-chain agentURI).
export function registrationFile(url, agent) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'AR Data Agent',
    description: 'Pay-per-call Argentine data (USD/ARS quotes, INDEC inflation, national holidays and business days, CUIT and CBU/CVU validation) priced in wARS on Celo through x402. Built by Landing en 24h.',
    image: 'https://landingen24h.com/favicon.ico',
    services: [{ name: 'web', endpoint: url + '/' }, { name: 'x402', endpoint: url + '/' }],
    x402Support: true,
    active: true,
    registrations: agent && agent.agentId != null ? [{ agentId: Number(agent.agentId), agentRegistry: agent.registry }] : [],
    supportedTrust: ['reputation'],
  };
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Human-readable catalog for people who open the agent URL in a browser. */
export function catalogHtml(d, self) {
  const rows = d.routes.map(r => `<tr><td><code>${esc(r.url.replace(self, ''))}</code></td><td>${esc(r.price_wars)} wARS</td><td>${esc(r.description)}</td><td>${r.query ? `<code>${esc(Object.keys(r.query).join(', '))}</code>` : ''}</td></tr>`).join('');
  const first = d.routes[0] ? d.routes[0].url : self + '/ar/dolar';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.name)}: Argentine data, pay per call in pesos on Celo</title>
<meta name="description" content="${esc(d.description)}">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1b1b1b}code,pre{background:#f3f3f0;border-radius:4px;padding:.1em .3em}pre{padding:.8em;overflow:auto}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.4em;text-align:left;vertical-align:top}a{color:#0a6b4f}</style></head><body>
<h1>${esc(d.name)}</h1>
<p>${esc(d.description)}</p>
<h2>Paid routes</h2>
<table><thead><tr><th>Route</th><th>Price</th><th>What you get</th><th>Query</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Try it</h2>
<p>Without a payment the server answers <code>402 Payment Required</code> with the exact x402 terms (asset, amount, pay-to ${esc(d.payTo)}). Any x402 client on Celo pays and retries automatically; the payer needs no gas.</p>
<pre>curl -i ${esc(first)}</pre>
<p>Need wARS? <a href="${esc(d.get_wars)}">Get a Ripio ramp link</a> (ARS to wARS on Celo). Machine-readable catalog: <a href="${esc(self)}/?format=json">JSON</a>, <a href="${esc(self)}/prices">prices</a>, <a href="${esc(self)}/.well-known/agent-registration.json">ERC-8004 registration</a>.</p>
<h2>Free live badges</h2>
<p><img src="https://landingen24h.com/badge/dolar-blue.svg" alt="dolar blue"> <img src="https://landingen24h.com/badge/dolar-oficial.svg" alt="dolar oficial"> <img src="https://landingen24h.com/badge/dolar-mep.svg" alt="dolar MEP"></p>
<pre>![dolar blue](https://landingen24h.com/badge/dolar-blue.svg)</pre>
<p>Open source (MIT): <a href="${esc(d.source)}">${esc(d.source)}</a></p>
</body></html>`;
}
