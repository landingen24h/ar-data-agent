import { describe, it, expect } from 'vitest';
import { NEAR_USDC, createCredits, creditsFor, getQuote, isNearAccount, memoryStore, minFromError, packAmount, quoteRequest } from '../src/near.js';

const RECIP = 'a'.repeat(64);
const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const now = () => Date.parse('2026-11-01T00:00:00Z');

function mockFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const h = routes[path];
    if (!h) return new Response('{}', { status: 404 });
    const [status, body] = h(url, init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls; return f;
}

describe('near helpers', () => {
  it('validates NEAR account ids', () => {
    expect(isNearAccount('landingen24h.near')).toBe(true);
    expect(isNearAccount(RECIP)).toBe(true);
    expect(isNearAccount('Bad.near')).toBe(false);
    expect(isNearAccount('a')).toBe(false);
    expect(isNearAccount('x'.repeat(65))).toBe(false);
  });
  it('prices packs with a bridge floor and floors credits', () => {
    expect(packAmount(20, 10000)).toBe('200000');
    expect(packAmount(5, 10000, 150000)).toBe('150000');
    expect(() => packAmount(0, 10000)).toThrow();
    expect(creditsFor('150000', 10000)).toBe(15);
    expect(creditsFor('9999', 10000)).toBe(0);
  });
  it('builds an EXACT_OUTPUT quote to NEAR USDC', () => {
    const q = quoteRequest({ originAsset: BASE_USDC, refundTo: '0xabc', recipient: RECIP, amount: '200000', now });
    expect(q).toMatchObject({ swapType: 'EXACT_OUTPUT', destinationAsset: NEAR_USDC, recipient: RECIP, amount: '200000', dry: true, deadline: '2026-11-01T00:30:00.000Z' });
    expect(() => quoteRequest({ originAsset: BASE_USDC, refundTo: '0xabc', recipient: 'Nope!', amount: '1' })).toThrow();
    expect(() => quoteRequest({ originAsset: BASE_USDC, refundTo: '0xabc', recipient: RECIP, amount: '-1' })).toThrow();
  });
  it('reads the bridge minimum from 1Click errors', async () => {
    const fetchImpl = mockFetch({ '/v0/quote': () => [400, { message: 'Amount is too low for bridge, try at least 144446' }] });
    const e = await getQuote({ originAsset: BASE_USDC, refundTo: '0xabc', recipient: RECIP, amount: '10000' }, { fetchImpl, now }).catch(x => x);
    expect(e.status).toBe(400);
    expect(minFromError(e)).toBe('144446');
  });
});

describe('credit ledger', () => {
  const quoteBody = { quote: { depositAddress: '0xdep', amountIn: '201000', amountOut: '200000', deadline: '2026-11-01T00:30:00Z' }, correlationId: 'c1' };
  function setup(status = 'SUCCESS', amountOut = '200000') {
    const fetchImpl = mockFetch({
      '/v0/quote': () => [200, quoteBody],
      '/v0/status': () => [200, { status, swapDetails: { amountOut, destinationChainTxHashes: [{ hash: 'Htx' }] } }],
    });
    const store = memoryStore();
    const credits = createCredits({ store, unitPrice: 10000, recipient: RECIP, io: { fetchImpl } });
    return { fetchImpl, credits };
  }
  async function liveQuote(fetchImpl) {
    return getQuote({ originAsset: BASE_USDC, refundTo: '0xabc', recipient: RECIP, amount: '200000', dry: false }, { fetchImpl, now });
  }

  it('mints credits once after SUCCESS and spends them down', async () => {
    const { fetchImpl, credits } = setup();
    const q = await liveQuote(fetchImpl);
    expect(JSON.parse(fetchImpl.calls[0].init.body).dry).toBe(false);
    await credits.open(q);
    const r = await credits.redeem('0xdep');
    expect(r).toMatchObject({ ok: true, credits: 20, destinationTx: 'Htx' });
    expect(await credits.redeem('0xdep')).toMatchObject({ ok: false, error: 'already_redeemed' });
    for (let i = 19; i >= 0; i--) expect(await credits.spend(r.token)).toEqual({ ok: true, left: i });
    expect(await credits.spend(r.token)).toMatchObject({ ok: false, error: 'no_credits_left' });
  });
  it('refuses unsettled, unknown and foreign top-ups', async () => {
    const { fetchImpl, credits } = setup('PROCESSING');
    const q = await liveQuote(fetchImpl);
    await credits.open(q);
    expect(await credits.redeem('0xdep')).toMatchObject({ ok: false, error: 'not_settled', status: 'PROCESSING' });
    expect(await credits.redeem('0xother')).toMatchObject({ ok: false, error: 'unknown_topup' });
    await expect(credits.open({ ...q, recipient: 'someone.near' })).rejects.toThrow(/not for this agent/);
    await expect(credits.open({ ...q, depositAddress: null })).rejects.toThrow(/live quote/);
  });
  it('rejects malformed and unknown credit tokens', async () => {
    const { credits } = setup();
    expect(await credits.spend('nope')).toMatchObject({ ok: false, error: 'bad_token' });
    expect(await credits.spend('arc_' + '0'.repeat(48))).toMatchObject({ ok: false, error: 'unknown_token' });
  });
});
