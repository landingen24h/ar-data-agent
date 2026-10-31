// NEAR Intents (1Click) top-up rail for ar-data-agent.
//
// Cross-chain bridges have a minimum (~0.15 USDC from Base at the time of writing), so
// per-call micropayments from other chains are not viable. Instead a caller buys a
// small pack of call credits: the agent asks 1Click for an EXACT_OUTPUT quote that
// delivers USDC on NEAR to the agent's NEAR account, the caller sends the quoted
// amount from whatever chain/token they hold, and once 1Click reports SUCCESS the
// agent mints a bearer credit token good for N paid calls.
//
// Nothing here holds a NEAR key: the agent only *receives* on NEAR. Keys stay out of
// this module by design.

export const ONE_CLICK = 'https://1click.chaindefuser.com';
export const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const UA = 'ar-data-agent (+https://landingen24h.com/celo/)';

export function isNearAccount(id) {
  return typeof id === 'string' && id.length >= 2 && id.length <= 64 && NEAR_ACCOUNT_RE.test(id);
}

/** Price a pack: calls x unit price (USDC base units, 6 decimals), never below the floor. */
export function packAmount(calls, unitPrice, minAmount = 0) {
  if (!Number.isInteger(calls) || calls < 1 || calls > 1000) throw new Error('calls must be an integer 1..1000');
  const u = BigInt(unitPrice), min = BigInt(minAmount);
  const raw = u * BigInt(calls);
  return (raw < min ? min : raw).toString();
}

/** Credits bought by a delivered amount (floor). */
export function creditsFor(amountOut, unitPrice) {
  const u = BigInt(unitPrice);
  if (u <= 0n) throw new Error('unitPrice must be > 0');
  return Number(BigInt(amountOut) / u);
}

function deadlineIso(now, minutes) {
  return new Date(now() + minutes * 60_000).toISOString();
}

/**
 * Build the 1Click quote request. EXACT_OUTPUT so the agent always receives `amount`
 * USDC on NEAR; the payer covers bridge fees on the origin side.
 */
export function quoteRequest({ originAsset, refundTo, recipient, amount, dry = true, minutes = 30, now = Date.now, slippageBps = 100 }) {
  if (!originAsset || typeof originAsset !== 'string') throw new Error('originAsset required (1Click assetId)');
  if (!refundTo || typeof refundTo !== 'string') throw new Error('refundTo required (payer address on the origin chain)');
  if (!isNearAccount(recipient)) throw new Error('recipient must be a NEAR account id');
  if (!/^\d+$/.test(String(amount)) || BigInt(amount) <= 0n) throw new Error('amount must be a positive integer string');
  return {
    dry, swapType: 'EXACT_OUTPUT', slippageTolerance: slippageBps,
    originAsset, depositType: 'ORIGIN_CHAIN',
    destinationAsset: NEAR_USDC, amount: String(amount),
    refundTo, refundType: 'ORIGIN_CHAIN',
    recipient, recipientType: 'DESTINATION_CHAIN',
    deadline: deadlineIso(now, minutes),
  };
}

async function oneClick(path, { method = 'GET', body, fetchImpl = fetch, base = ONE_CLICK, jwt } = {}) {
  const headers = { 'user-agent': UA, accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const r = await fetchImpl(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = {}; }
  if (!r.ok) {
    const e = new Error(`1click ${path} ${r.status}: ${String(j.message || 'error').slice(0, 200)}`);
    e.status = r.status; e.body = j; throw e;
  }
  return j;
}

export async function getQuote(opts, io = {}) {
  const req = quoteRequest({ ...opts, now: io.now || Date.now });
  const j = await oneClick('/v0/quote', { method: 'POST', body: req, ...io });
  const q = j.quote || {};
  return {
    dry: req.dry,
    depositAddress: q.depositAddress || null,
    amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd,
    amountOut: q.amountOut, deadline: q.deadline || req.deadline, timeEstimate: q.timeEstimate,
    originAsset: req.originAsset, destinationAsset: NEAR_USDC, recipient: req.recipient,
    correlationId: j.correlationId,
  };
}

/** Parse the bridge minimum out of a 1Click "Amount is too low" error, if present. */
export function minFromError(e) {
  const m = /at least (\d+)/.exec(e && e.message || '');
  return m ? m[1] : null;
}

export async function getStatus(depositAddress, io = {}) {
  if (!depositAddress) throw new Error('depositAddress required');
  const j = await oneClick(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, io);
  const d = j.swapDetails || {};
  return {
    status: j.status, // PENDING_DEPOSIT | KNOWN_DEPOSIT_TX | PROCESSING | SUCCESS | INCOMPLETE_DEPOSIT | REFUNDED | FAILED
    amountOut: d.amountOut || null,
    destinationTx: (d.destinationChainTxHashes || [])[0]?.hash || null,
    originTx: (d.originChainTxHashes || [])[0]?.hash || null,
  };
}

/** Minimal async KV: Map in tests/Node, Workers KV or a Durable Object in prod. */
export function memoryStore() {
  const m = new Map();
  return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}

function randomToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return 'arc_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Credit ledger. A top-up is keyed by its 1Click deposit address; it can be redeemed
 * into credits exactly once, only after 1Click reports SUCCESS, and only for the
 * recipient and asset the agent quoted (a caller cannot point us at someone else's swap).
 */
export function createCredits({ store = memoryStore(), unitPrice, recipient, io = {} }) {
  if (!isNearAccount(recipient)) throw new Error('recipient must be a NEAR account id');
  const unit = String(unitPrice);
  return {
    async open(quote) {
      if (!quote.depositAddress) throw new Error('live quote required (dry quotes have no deposit address)');
      if (quote.recipient !== recipient || quote.destinationAsset !== NEAR_USDC) throw new Error('quote not for this agent');
      await store.put(`topup:${quote.depositAddress}`, JSON.stringify({ state: 'open', amountOut: quote.amountOut, deadline: quote.deadline }));
      return { depositAddress: quote.depositAddress };
    },
    async redeem(depositAddress) {
      const raw = await store.get(`topup:${depositAddress}`);
      if (!raw) return { ok: false, error: 'unknown_topup' };
      const t = JSON.parse(raw);
      if (t.state === 'redeemed') return { ok: false, error: 'already_redeemed' };
      const s = await getStatus(depositAddress, io);
      if (s.status !== 'SUCCESS') return { ok: false, error: 'not_settled', status: s.status };
      const delivered = s.amountOut || t.amountOut;
      const credits = creditsFor(delivered, unit);
      if (credits < 1) return { ok: false, error: 'amount_below_unit_price' };
      const token = randomToken();
      // Mark redeemed before issuing so a concurrent retry cannot mint twice.
      await store.put(`topup:${depositAddress}`, JSON.stringify({ ...t, state: 'redeemed' }));
      await store.put(`credit:${token}`, JSON.stringify({ left: credits, depositAddress, destinationTx: s.destinationTx }));
      return { ok: true, token, credits, destinationTx: s.destinationTx };
    },
    async spend(token) {
      if (!/^arc_[0-9a-f]{48}$/.test(token || '')) return { ok: false, error: 'bad_token' };
      const raw = await store.get(`credit:${token}`);
      if (!raw) return { ok: false, error: 'unknown_token' };
      const c = JSON.parse(raw);
      if (c.left < 1) return { ok: false, error: 'no_credits_left' };
      c.left -= 1;
      await store.put(`credit:${token}`, JSON.stringify(c));
      return { ok: true, left: c.left };
    },
  };
}
