import type { AppConfig, Facilitator, PaymentPayload, PaymentRequirements } from './types.ts';
import { USDC, NETWORKS, toAtomic, isAddress, b64encode, b64decodeJson } from './rules.ts';
import { httpFacilitator } from './facilitator.ts';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-payment',
  'access-control-expose-headers': 'x-payment-response',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

const defaultWork = async (request: Request) => ({ message: 'paid result', at: new URL(request.url).pathname });

/**
 * A web standard app (Node, Hono, Bun or a worker): GET /health is free, GET /paid costs `price` USDC over x402.
 * Unpaid: 402 with the version 1 requirements. Paid: verify, settle, then the work, then 200 with X-PAYMENT-RESPONSE.
 * A payment that does not verify or settle gets 402 and the work is not done.
 */
export function createApp(config: AppConfig): { fetch(request: Request): Promise<Response> } {
  const atomic = toAtomic(config.price);
  if (!isAddress(config.payTo)) throw new Error('payTo must be 0x and 40 hex');
  if (!NETWORKS.includes(config.network)) throw new Error(`network must be one of ${NETWORKS.join(', ')}`);
  const facilitator: Facilitator = typeof config.facilitator === 'string' ? httpFacilitator(config.facilitator) : config.facilitator;
  if (!facilitator || typeof facilitator.verify !== 'function' || typeof facilitator.settle !== 'function') throw new Error('facilitator must have verify and settle');
  const usdc = USDC[config.network];
  const description = config.description || `Paid route, ${config.price} USDC per call over x402`;
  const work = config.work || defaultWork;

  function requirements(request: Request): PaymentRequirements {
    const u = new URL(request.url);
    return {
      scheme: 'exact',
      network: config.network,
      maxAmountRequired: atomic,
      resource: `${u.origin}${u.pathname}`,
      description,
      mimeType: 'application/json',
      payTo: config.payTo,
      maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
      asset: usdc.address,
      extra: { name: usdc.name, version: usdc.version },
    };
  }
  const required = (req: PaymentRequirements, error: string) => json({ x402Version: 1, error, accepts: [req] }, 402);

  async function fetchHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/paid') return json({ error: 'not found' }, 404);
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { allow: 'GET, POST' });

    const req = requirements(request);
    const header = request.headers.get('x-payment');
    if (!header) return required(req, 'X-PAYMENT header is required');

    let payment: PaymentPayload;
    try {
      const p = b64decodeJson(header) as PaymentPayload;
      if (!p || typeof p !== 'object') throw new Error('not an object');
      payment = p;
    } catch {
      return required(req, 'X-PAYMENT is not base64 JSON');
    }
    if (payment.x402Version !== 1) return required(req, 'unsupported x402Version');
    if (payment.scheme !== 'exact' || payment.network !== config.network) return required(req, 'payment scheme or network does not match');

    let verified;
    try { verified = await facilitator.verify(payment, req); } catch { return required(req, 'payment verification failed'); }
    if (!verified || verified.isValid !== true) return required(req, `payment did not verify: ${verified?.invalidReason || 'invalid'}`);

    let settled;
    try { settled = await facilitator.settle(payment, req); } catch { return required(req, 'payment settlement failed'); }
    if (!settled || settled.success !== true) return required(req, `payment did not settle: ${settled?.errorReason || 'failed'}`);

    let result: unknown;
    try { result = await work(request); } catch { result = { error: 'the work failed after payment; contact the operator with the transaction' }; }
    const receipt = { success: true, transaction: settled.transaction, network: settled.network || config.network, payer: settled.payer || verified.payer };
    return json({ ok: true, result, payment: { transaction: receipt.transaction, network: receipt.network } }, 200, { 'x-payment-response': b64encode(receipt) });
  }

  return { fetch: fetchHandler };
}
