import type { Network } from './types.ts';

/** USDC contract per network (6 decimals). */
export const USDC: Record<Network, { address: string; name: string; version: string }> = {
  base: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2' },
  'base-sepolia': { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' },
};

export const NETWORKS: Network[] = ['base', 'base-sepolia'];

/** "0.01" -> "10000". Throws on anything that is not a positive decimal with at most 6 decimals. */
export function toAtomic(price: string): string {
  if (typeof price !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(price)) throw new Error(`price must be a decimal USDC string such as "0.01", got ${JSON.stringify(price)}`);
  const [whole, frac = ''] = price.split('.');
  const atomic = BigInt(whole) * 1000000n + BigInt(frac.padEnd(6, '0'));
  if (atomic <= 0n) throw new Error('price must be above 0');
  return atomic.toString();
}

export function isAddress(a: unknown): a is string {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
}

export function b64encode(o: unknown): string {
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
}

export function b64decodeJson(s: string): unknown {
  const t = String(s).trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) throw new Error('not base64');
  return JSON.parse(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}
