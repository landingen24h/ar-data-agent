// Assets and prices. Addresses and EIP-712 `extra` values come from the Celo
// x402 facilitator's own table (https://x402.celo.org/api/config, /supported).
import { getAddress } from 'viem';
import { declareBuilderCodeExtension } from '@x402/extensions/builder-code';
import { ATTRIBUTION_CODE } from './attribution-code.js';

export const CELO_MAINNET = 'eip155:42220';
export const FACILITATOR_MAINNET = 'https://api.x402.celo.org';
export const FACILITATOR_TESTNET = 'https://api.x402.sepolia.celo.org';

export const ASSETS = {
  wARS: { address: getAddress('0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D'), decimals: 18, extra: { name: 'Peso Argentino', version: '1', assetTransferMethod: 'permit2' } },
  USDC: { address: getAddress('0xcebA9300f2b948710d2653dD7B07f33A8B32118C'), decimals: 6, extra: { name: 'USDC', version: '2' } },
  USDT: { address: getAddress('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'), decimals: 6, extra: { name: 'Tether USD', version: '1' } },
};

// Human prices per call. wARS is the primary price (pesos in, pesos priced);
// USDC/USDT are offered as an alternative for buyers that only hold dollars.
export const ROUTES = {
  '/ar/dolar': { wars: '15', usd: '0.01', description: 'Argentina USD/ARS quotes: oficial, blue, MEP, CCL, cripto, tarjeta, mayorista', query: { casa: 'all | oficial | blue | mep | ccl | cripto | tarjeta | mayorista' } },
  '/ar/inflacion': { wars: '15', usd: '0.01', description: 'Argentina inflation (INDEC CPI): latest monthly and YoY, cumulative between months, amount adjuster', query: { from: 'YYYY-MM (optional)', to: 'YYYY-MM (optional)', amount: 'number (optional)' } },
  '/ar/feriados': { wars: '15', usd: '0.01', description: 'Argentina national holidays and business-day calculator', query: { year: 'YYYY (optional)', date: 'YYYY-MM-DD (optional)', add_business_days: '1-60 (optional, needs date)' } },
  '/ar/cuit': { wars: '10', usd: '0.01', description: 'Validate an Argentine CUIT/CUIL (check digit, entity type)', query: { cuit: '11 digits, dashes optional' } },
  '/ar/cbu': { wars: '10', usd: '0.01', description: 'Validate an Argentine CBU/CVU (both check digits, bank)', query: { cbu: '22 digits' } },
};

// "15" wARS -> "15000000000000000000" (string base units, never floats)
export function toBaseUnits(human, decimals) {
  const [i, f = ''] = String(human).split('.');
  if (f.length > decimals) throw new Error('too many decimals');
  return (BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

export function acceptsFor(route, payTo, { network = CELO_MAINNET, includeUsd = true } = {}) {
  const r = ROUTES[route];
  const to = getAddress(payTo);
  const opt = (sym, human) => ({ scheme: 'exact', network, payTo: to, price: { amount: toBaseUnits(human, ASSETS[sym].decimals), asset: ASSETS[sym].address, extra: { ...ASSETS[sym].extra } } });
  const list = [opt('wARS', r.wars)];
  if (includeUsd) list.push(opt('USDC', r.usd), opt('USDT', r.usd));
  return list;
}

// Route table in the shape @x402/hono expects. The Permit2 route MUST declare
// eip2612GasSponsoring or first-time payers get 412 permit2_allowance_required.
export function x402Routes(payTo, opts = {}) {
  const base = opts.basePath || '';
  const out = {};
  for (const [path, r] of Object.entries(ROUTES)) {
    out[`GET ${base}${path}`] = {
      accepts: acceptsFor(path, payTo, opts),
      description: r.description,
      mimeType: 'application/json',
      extensions: {
        eip2612GasSponsoring: { info: { description: 'The facilitator sponsors the EIP-2612 permit to Permit2.', version: '1' } },
        // ERC-8021 Schema 2 app code for settlements; picked up once the facilitator writes builder codes.
        'builder-code': declareBuilderCodeExtension(ATTRIBUTION_CODE),
      },
    };
  }
  return out;
}
