/**
 * Cerberus chamber 3: intent. The agent states what it wants to do on which job,
 * at what price, on which chain and by when. The chamber checks that statement
 * against the public terms of the job. Pure: the clock is passed in.
 */
export type IntentAction = 'bid' | 'deliver';
export type Chain = 'base' | 'solana';

export interface Intent {
  job_id: string;
  action: IntentAction;
  price_usdc: number;
  settlement_chain: Chain;
  delivery_by: string;
}

export interface JobTerms {
  id: string;
  status: 'open' | 'selected' | 'closed';
  bounty_usdc: number;
  bid_closes: string;
  deadline: string;
  chains: Chain[];
}

export type IntentReason =
  | 'ok'
  | 'malformed_intent'
  | 'wrong_job'
  | 'job_not_open'
  | 'action_not_allowed'
  | 'bad_price'
  | 'over_ceiling'
  | 'chain_not_offered'
  | 'window_closed'
  | 'late_delivery';

export interface IntentResult {
  ok: boolean;
  reason: IntentReason;
}

function wellFormed(i: unknown): i is Intent {
  if (!i || typeof i !== 'object') return false;
  const x = i as Record<string, unknown>;
  return (
    typeof x.job_id === 'string' &&
    (x.action === 'bid' || x.action === 'deliver') &&
    typeof x.price_usdc === 'number' &&
    (x.settlement_chain === 'base' || x.settlement_chain === 'solana') &&
    typeof x.delivery_by === 'string' &&
    Number.isFinite(Date.parse(x.delivery_by))
  );
}

export function checkIntent(intent: unknown, job: JobTerms, now: Date | number): IntentResult {
  const t = typeof now === 'number' ? now : now.getTime();
  if (!wellFormed(intent)) return { ok: false, reason: 'malformed_intent' };
  if (intent.job_id !== job.id) return { ok: false, reason: 'wrong_job' };
  if (intent.action === 'bid') {
    if (job.status !== 'open') return { ok: false, reason: 'job_not_open' };
  } else if (job.status !== 'selected') {
    return { ok: false, reason: 'action_not_allowed' };
  }
  if (!Number.isFinite(intent.price_usdc) || intent.price_usdc <= 0) return { ok: false, reason: 'bad_price' };
  if (intent.price_usdc > job.bounty_usdc) return { ok: false, reason: 'over_ceiling' };
  if (!job.chains.includes(intent.settlement_chain)) return { ok: false, reason: 'chain_not_offered' };
  if (intent.action === 'bid' && t >= Date.parse(job.bid_closes)) return { ok: false, reason: 'window_closed' };
  if (Date.parse(intent.delivery_by) > Date.parse(job.deadline)) return { ok: false, reason: 'late_delivery' };
  return { ok: true, reason: 'ok' };
}
