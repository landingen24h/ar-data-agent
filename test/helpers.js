// Test helpers. Everything here is local: a stub facilitator that counts calls, a stub upstream
// fetch that serves the recorded fixtures, and a small JSON Schema checker. No network, no money.
import { readFileSync } from 'node:fs';
import agent from '../src/agent.js';

const fx = f => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
export const ORIGIN = 'https://landingen24h.com';

// Stub facilitator: verify and settle succeed, and every call is counted.
export function stubFacilitator() {
  const calls = { verify: 0, settle: 0 };
  return {
    calls,
    verify: async () => { calls.verify++; return { isValid: true, payer: '0x000000000000000000000000000000000000dEaD' }; },
    settle: async () => { calls.settle++; return { success: true, transaction: '0xtest', network: 'base', payer: '0x000000000000000000000000000000000000dEaD' }; },
  };
}

// A well formed (but fake) x402 version 1 payment header for Base. Only the stub facilitator sees it.
export function fakePaymentHeader(network = 'base') {
  return Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network, payload: { signature: '0xstub', authorization: {} } })).toString('base64');
}

const AUDIT_HTML = '<!doctype html><html lang="en"><head><title>Test page for the audit capability</title><meta name="viewport" content="width=device-width"><meta name="description" content="A small page served by the test stub so the audit runs offline and gives a stable result."></head><body><h1>Hello</h1><img src="a.png"></body></html>';

// Replaces globalThis.fetch with recorded upstream answers. Returns the list of URLs requested.
export function stubUpstream() {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url || input);
    seen.push(u);
    const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u === 'https://dolarapi.com/v1/dolares') return json(fx('dolarapi-dolares.json'));
    if (u === 'https://api.argentinadatos.com/v1/feriados/2026') return json(fx('argentinadatos-feriados-2026.json'));
    if (u === 'https://api.argentinadatos.com/v1/feriados/2027') return json(fx('argentinadatos-feriados-2027.json'));
    if (u === 'https://api.argentinadatos.com/v1/finanzas/indices/inflacion') return json(fx('argentinadatos-inflacion.json'));
    if (u === 'https://api.argentinadatos.com/v1/finanzas/indices/inflacionInteranual') return json(fx('argentinadatos-inflacion-interanual.json'));
    if (u === 'https://api.frankfurter.dev/v2/rate/usd/eur') return json(fx('frankfurter-usd-eur.json'));
    if (u.startsWith('https://audit.example.org')) return new Response(AUDIT_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': 'max-age=1' } });
    if (u.startsWith('http://audit.example.org')) return new Response(null, { status: 301, headers: { location: 'https://audit.example.org/' } });
    if (u.startsWith('https://unreadable.example.org')) throw new TypeError('fetch failed');
    throw new Error('unexpected upstream in test: ' + u);
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

export async function call(path, { body, method = 'POST', paid = false, network, facilitator } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (paid) headers['x-payment'] = fakePaymentHeader(network);
  const req = new Request(ORIGIN + path, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  const res = await agent.fetch(req, { facilitator }, { waitUntil() {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json };
}

// Minimal JSON Schema check (type, required, properties, items, enum). Returns a list of problems.
export function check(schema, v, at = '$') {
  const out = [];
  const types = [].concat(schema.type || []);
  const typeOf = x => x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x;
  if (types.length && !types.some(t => t === typeOf(v) || (t === 'number' && typeOf(v) === 'integer'))) return [`${at}: expected ${types.join('|')}, got ${typeOf(v)}`];
  if (schema.enum && !schema.enum.includes(v)) out.push(`${at}: not in enum`);
  if (typeOf(v) === 'object') {
    for (const k of schema.required || []) if (!(k in v)) out.push(`${at}.${k}: required`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v && v[k] !== undefined) out.push(...check(s, v[k], `${at}.${k}`));
  }
  if (typeOf(v) === 'array' && schema.items) v.forEach((x, i) => out.push(...check(schema.items, x, `${at}[${i}]`)));
  return out;
}
