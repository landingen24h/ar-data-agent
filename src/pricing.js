// Assets and prices. Addresses and EIP-712 `extra` values come from the Celo
// x402 facilitator's own table (https://x402.celo.org/api/config, /supported).
import { getAddress } from 'viem';
import { declareBuilderCodeExtension } from '@x402/extensions/builder-code';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { ATTRIBUTION_CODE } from './attribution-code.js';

export const CELO_MAINNET = 'eip155:42220';
export const FACILITATOR_MAINNET = 'https://api.x402.celo.org';
export const FACILITATOR_TESTNET = 'https://api.x402.sepolia.celo.org';

export const ASSETS = {
  wARS: { address: getAddress('0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D'), decimals: 18, extra: { name: 'Peso Argentino', version: '1', assetTransferMethod: 'permit2' } },
  USDC: { address: getAddress('0xcebA9300f2b948710d2653dD7B07f33A8B32118C'), decimals: 6, extra: { name: 'USDC', version: '2' } },
  USDT: { address: getAddress('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'), decimals: 6, extra: { name: 'Tether USD', version: '1' } },
  // USA₮ (Tether America USD, issued by Anchorage Digital Bank). Official Celo address per
  // usat.io/supported-protocols and docs.celo.org; EIP-3009 on the Celo facilitator.
  USAT: { address: getAddress('0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771'), decimals: 6, extra: { name: 'Tether America USD', version: '1' } },
};
export const USD_ASSETS = ['USDC', 'USDT', 'USAT'];

// Human prices per call. wARS is the primary price (pesos in, pesos priced);
// USDC/USDT are offered as an alternative for buyers that only hold dollars.
export const ROUTES = {
  '/ar/dolar': { wars: '15', usd: '0.01', description: 'Argentina USD/ARS quotes: oficial, blue, MEP, CCL, cripto, tarjeta, mayorista', query: { casa: 'all | oficial | blue | mep | ccl | cripto | tarjeta | mayorista' } },
  '/ar/inflacion': { wars: '15', usd: '0.01', description: 'Argentina inflation (INDEC CPI): latest monthly and YoY, cumulative between months, amount adjuster', query: { from: 'YYYY-MM (optional)', to: 'YYYY-MM (optional)', amount: 'number (optional)' } },
  '/ar/feriados': { wars: '15', usd: '0.01', description: 'Argentina national holidays and business-day calculator', query: { year: 'YYYY (optional)', date: 'YYYY-MM-DD (optional)', add_business_days: '1-60 (optional, needs date)' } },
  '/ar/cuit': { wars: '10', usd: '0.01', description: 'Validate an Argentine CUIT/CUIL (check digit, entity type)', query: { cuit: '11 digits, dashes optional' } },
  '/ar/cbu': { wars: '10', usd: '0.01', description: 'Validate an Argentine CBU/CVU (both check digits, bank)', query: { cbu: '22 digits' } },
};

// Routes that make the agent BUY an upstream service (see buy.js). Listed and gated
// only when the buy flag is on, so a disabled deployment never quotes them.
export const BUY_ROUTES = {
  '/ar/brief': { wars: '45', usd: '0.03', description: 'Plain-language brief of today\'s USD/ARS quotes and the blue/MEP/CCL gap, written by an LLM the agent buys per call over x402 (Cencori via usebuy.ai)', query: { lang: 'es | en (optional, default es)' } },
};
// Bazaar discovery metadata (x402 "bazaar" extension): example input, input schema and,
// where we have one, an example output captured from a real call, so x402 catalogs
// (Celo Buy, agent402, x402scan) can show agents how to call each route.
const str = (description, pattern) => ({ type: 'string', description, ...(pattern ? { pattern } : {}) });
export const DISCOVERY = {
  '/ar/dolar': { input: { casa: 'blue' }, inputSchema: { properties: { casa: { type: 'string', enum: ['all', 'oficial', 'blue', 'mep', 'ccl', 'cripto', 'tarjeta', 'mayorista'] } } },
    output: { example: { currency_pair: 'USD/ARS', casa: 'blue', quotes: [{ casa: 'blue', nombre: 'Blue', compra: 1555, venta: 1575, spread: 20, updated_at: '2026-10-28T11:59:00.000Z' }], source: 'DolarApi.com (public Argentine market quotes)', note: 'ARS per 1 USD. Market quotes, not financial advice.' } } },
  '/ar/inflacion': { input: { from: '2026-01', to: '2026-09' }, inputSchema: { properties: { from: str('YYYY-MM', '^\\d{4}-\\d{2}$'), to: str('YYYY-MM', '^\\d{4}-\\d{2}$'), amount: str('amount to adjust by cumulative inflation') } } },
  '/ar/feriados': { input: { year: '2026' }, inputSchema: { properties: { year: str('YYYY', '^\\d{4}$'), date: str('YYYY-MM-DD', '^\\d{4}-\\d{2}-\\d{2}$'), add_business_days: str('1-60, needs date') } } },
  '/ar/cuit': { input: { cuit: '20-12345678-6' }, inputSchema: { properties: { cuit: str('11 digits, dashes optional') }, required: ['cuit'] },
    output: { example: { input: '20-12345678-6', normalized: '20123456786', valid: true, formatted: '20-12345678-6', prefix: '20', entity_type: 'person', expected_check_digit: 6 } } },
  '/ar/cbu': { input: { cbu: '2850590909400123456785' }, inputSchema: { properties: { cbu: str('22 digits') }, required: ['cbu'] },
    output: { example: { normalized: '2850590909400123456785', valid: true, type: 'CBU', entity_code: '285', branch_code: '0590', bank_name: 'Banco Macro', block1_ok: true, block2_ok: true } } },
  '/ar/brief': { input: { lang: 'es' }, inputSchema: { properties: { lang: { type: 'string', enum: ['es', 'en'] } } } },
};
export const discoveryFor = (path) => (DISCOVERY[path] ? declareDiscoveryExtension(DISCOVERY[path]) : {});

export const routeTable = (buy = false) => (buy ? { ...ROUTES, ...BUY_ROUTES } : ROUTES);

// "15" wARS -> "15000000000000000000" (string base units, never floats)
export function toBaseUnits(human, decimals) {
  const [i, f = ''] = String(human).split('.');
  if (f.length > decimals) throw new Error('too many decimals');
  return (BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

export function acceptsFor(route, payTo, { network = CELO_MAINNET, includeUsd = true } = {}) {
  const r = ROUTES[route] || BUY_ROUTES[route];
  const to = getAddress(payTo);
  const opt = (sym, human) => ({ scheme: 'exact', network, payTo: to, price: { amount: toBaseUnits(human, ASSETS[sym].decimals), asset: ASSETS[sym].address, extra: { ...ASSETS[sym].extra } } });
  const list = [opt('wARS', r.wars)];
  if (includeUsd) for (const sym of USD_ASSETS) list.push(opt(sym, r.usd));
  return list;
}

// Route table in the shape @x402/hono expects. The Permit2 route MUST declare
// eip2612GasSponsoring or first-time payers get 412 permit2_allowance_required.
export function x402Routes(payTo, opts = {}) {
  const base = opts.basePath || '';
  const out = {};
  for (const [path, r] of Object.entries(routeTable(!!opts.buy))) {
    out[`GET ${base}${path}`] = {
      accepts: acceptsFor(path, payTo, opts),
      description: r.description,
      mimeType: 'application/json',
      extensions: {
        eip2612GasSponsoring: { info: { description: 'The facilitator sponsors the EIP-2612 permit to Permit2.', version: '1' } },
        // ERC-8021 Schema 2 app code for settlements; picked up once the facilitator writes builder codes.
        'builder-code': declareBuilderCodeExtension(ATTRIBUTION_CODE),
        ...discoveryFor(path),
      },
    };
  }
  return out;
}
