import type { Facilitator, PaymentPayload, PaymentRequirements, VerifyResult, SettleResult } from './types.ts';

/** A facilitator over HTTP (POST <url>/verify and <url>/settle), for example https://facilitator.payai.network. */
export function httpFacilitator(url: string, fetchImpl: typeof fetch = globalThis.fetch): Facilitator {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) throw new Error('facilitator url must be https');
  const base = url.replace(/\/+$/, '');
  async function call<T>(path: 'verify' | 'settle', paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<T> {
    const r = await fetchImpl(`${base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    });
    const text = await r.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (!r.ok && path === 'verify') return { isValid: false, invalidReason: body.invalidReason || body.error || `facilitator ${r.status}` } as T;
    if (!r.ok) return { success: false, transaction: '', network: paymentRequirements.network, errorReason: body.errorReason || body.error || `facilitator ${r.status}` } as T;
    return body as T;
  }
  return {
    verify: (p, q) => call<VerifyResult>('verify', p, q),
    settle: (p, q) => call<SettleResult>('settle', p, q),
  };
}
