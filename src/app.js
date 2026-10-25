// Hono app: free discovery routes + x402-paid Argentine data routes on Celo.
// Runs unchanged on Node (src/node.js) and Cloudflare Workers (src/worker.js).
import { Hono } from 'hono';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getAddress, isAddress } from 'viem';
import { ASSETS, CELO_MAINNET, FACILITATOR_MAINNET, routeTable, x402Routes } from './pricing.js';
import * as d from './data.js';
import { BUY_SERVICE, briefPrompt, buyCompletion, dailyBudget, makeBuyer } from './buy.js';

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
  if (cfg.buy && cfg.buy.enabled && (cfg.buy.payFetch || cfg.buy.privateKey)) {
    const pf = cfg.buy.payFetch || makeBuyer({ privateKey: cfg.buy.privateKey, asset: cfg.buy.asset || 'USAT' }).payFetch;
    buyer = { payFetch: pf, asset: cfg.buy.asset || 'USAT', budget: dailyBudget(Number(cfg.buy.maxCallsPerDay) || 20) };
  }
  const PAID_ALL = buyer ? { ...PAID, '/ar/brief': {
    parse: q => { const lang = String(q.lang || 'es').toLowerCase(); return ['es', 'en'].includes(lang) ? { ok: true, input: { lang } } : { ok: false, error: 'lang_must_be_es_or_en', status: 400 }; },
    run: async (i, f) => {
      const dol = await d.getDolar({ casa: 'all' }, f);
      if (!dol.ok) return dol;
      if (!buyer.budget.take()) return { ok: false, error: 'brief_daily_budget_reached', status: 503 };
      const b = await buyCompletion(buyer.payFetch, briefPrompt(dol.data, i.lang));
      // Upstream failure -> our handler returns >= 400, so the caller's payment is NOT settled.
      if (!b.ok) return { ok: false, error: `upstream_${b.error}`, status: 502 };
      return { ok: true, data: { lang: i.lang, brief: b.text, data: dol.data, generated_by: { service: BUY_SERVICE.name, model: BUY_SERVICE.model, paid_with: buyer.asset, upstream_receipt: b.receipt }, note: 'AI-written summary of the quotes included below; not financial advice.' } };
    },
  } } : PAID;
  const ROUTES = routeTable(!!buyer);

  const server = new x402ResourceServer(facilitator);
  server.register('eip155:*', new ExactEvmScheme());

  const app = new Hono();
  const origin = c => cfg.publicUrl || new URL(c.req.url).origin;

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
  app.get(base + '/', c => c.json(describe(c)));
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

  // ---- x402 payment gate (verify -> handler -> settle only if handler < 400) ----
  app.use(paymentMiddleware(x402Routes(payTo, { basePath: base, network, buy: !!buyer }), server, undefined, undefined, cfg.syncFacilitatorOnStart ?? true));

  for (const [p, h] of Object.entries(PAID_ALL)) {
    app.get(base + p, async c => {
      const r = await h.run(c.get('input'), cfg.fetchImpl);
      if (!r.ok) return c.json({ error: r.error, charged: false }, r.status);
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
