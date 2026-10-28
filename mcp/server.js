#!/usr/bin/env node
// MCP server (stdio) for the AR Data Agent: Argentine data tools paid per call in wARS on Celo.
// Without AR_AGENT_PRIVATE_KEY the tools run in quote mode: they return the price and the
// payment requirements (free), nothing is paid. With a key, each call pays via x402
// (capped by AR_AGENT_MAX_WARS per call, default 20) and returns the data plus the tx hash.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makePayFetch } from '../scripts/pay.js';

const BASE = (process.env.AR_AGENT_URL || 'https://landingen24h.com/celo').replace(/\/$/, '');
const KEY = process.env.AR_AGENT_PRIVATE_KEY || process.env.BUYER_PRIVATE_KEY || '';
const ASSET = process.env.AR_AGENT_ASSET || 'wARS';
const MAX_WARS = process.env.AR_AGENT_MAX_WARS || '20';
// Payments are pinned to the AR Data Agent seller wallet, so pointing AR_AGENT_URL at a mirror
// can't send your wARS anywhere else. Override only if you run your own seller.
const PAY_TO = process.env.AR_AGENT_PAY_TO || '0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1';
const payer = KEY ? makePayFetch({ privateKey: KEY, asset: ASSET, maxWars: MAX_WARS, payTo: PAY_TO }) : null;

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function call(path, params) {
  const url = `${BASE}${path}${qs(params)}`;
  if (!payer) {
    const r = await fetch(url);
    const pr = r.headers.get('payment-required');
    let req = null;
    try { req = pr ? JSON.parse(Buffer.from(pr, 'base64').toString()) : await r.json(); } catch { /* ignore */ }
    const accepts = (req?.accepts || []).map(a => ({ network: a.network, asset: a.asset, amount: a.amount, payTo: a.payTo }));
    return { mode: 'quote', status: r.status, url, accepts,
      note: 'Quote mode: no AR_AGENT_PRIVATE_KEY set, nothing was paid. Set AR_AGENT_PRIVATE_KEY to a Celo wallet holding wARS (or USDC/USDT/USAT with AR_AGENT_ASSET) to get the data. Gasless for the payer.' };
  }
  const r = await payer.payFetch(url);
  const pr = r.headers.get('payment-response');
  return { mode: 'paid', status: r.status, url,
    settlement: pr ? JSON.parse(Buffer.from(pr, 'base64').toString()) : null,
    data: await r.json().catch(() => null) };
}

const out = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const server = new McpServer({ name: 'ar-data-agent', version: '0.2.2' });

server.tool('ar_dolar', 'Argentina USD/ARS quotes (oficial, blue, MEP, CCL, cripto, tarjeta, mayorista) with spread and blue gap. 15 wARS per call.',
  { casa: z.enum(['all', 'oficial', 'blue', 'mep', 'ccl', 'cripto', 'tarjeta', 'mayorista']).optional() },
  async (a) => out(await call('/ar/dolar', a)));
server.tool('ar_inflacion', 'Argentina INDEC CPI: latest monthly and YoY, compounded inflation between months, amount adjuster. 15 wARS per call.',
  { from: z.string().regex(/^\d{4}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}$/).optional(), amount: z.number().positive().optional() },
  async (a) => out(await call('/ar/inflacion', a)));
server.tool('ar_feriados', 'Argentina national holidays, is-business-day, next business day, date + N business days. 15 wARS per call.',
  { year: z.number().int().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), add_business_days: z.number().int().min(1).max(60).optional() },
  async (a) => out(await call('/ar/feriados', a)));
server.tool('ar_cuit', 'Validate an Argentine CUIT/CUIL (check digit, entity type, formatting; offline checksum, does not query ARCA). 10 wARS per call.',
  { cuit: z.string() }, async (a) => out(await call('/ar/cuit', a)));
server.tool('ar_cbu', 'Validate an Argentine CBU/CVU (check digits, CBU vs CVU, bank; offline checksum). 10 wARS per call.',
  { cbu: z.string() }, async (a) => out(await call('/ar/cbu', a)));
server.tool('ar_ramp_link', 'Free: get a Ripio on-ramp link that delivers wARS on Celo to an address (to fund calls).',
  { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.number().positive().optional() },
  async (a) => { const r = await fetch(`${BASE}/ramp${qs({ ...a, r: 'mcp' })}`); return out({ status: r.status, data: await r.json().catch(() => null) }); });

await server.connect(new StdioServerTransport());
