/**
 * The Cerberus airlock: runs the five chambers in order and stops at the first refusal.
 * Every chamber is injectable, so the same driver tests Kognai's real chambers or these
 * reference ones. No network, no clock of its own.
 */
import { verifyChallenge, type Challenge, type NonceStore } from './chambers/identity.ts';
import { scoreAgent } from './chambers/trust/index.ts';
import type { AgentRecord, OutsideScore, Tier } from './chambers/trust/index.ts';
import { checkIntent, type JobTerms } from './chambers/intent.ts';
import { verifyHandshake } from './chambers/soul.ts';
import { issueToken, verifyToken } from './chambers/session.ts';

export type ChamberName = 'identity' | 'trust' | 'intent' | 'soul' | 'session';
export const ORDER: ChamberName[] = ['identity', 'trust', 'intent', 'soul', 'session'];
const TIER_RANK: Record<Tier, number> = { unproven: 0, bronze: 1, silver: 2, gold: 3 };

export interface EntryRequest {
  challenge: Challenge;
  identitySignature: string;
  record: AgentRecord;
  outside?: OutsideScore | null;
  intent: unknown;
  handshake: unknown;
}

export interface AirlockContext {
  now: number;
  ownerAddress: string;
  store: NonceStore;
  job: JobTerms;
  soulSha256: string;
  minTier: Tier;
  sessionSecret: string;
  sessionTtlMs: number;
}

export interface Chambers {
  identity: typeof verifyChallenge;
  trust: typeof scoreAgent;
  intent: typeof checkIntent;
  soul: typeof verifyHandshake;
  issue: typeof issueToken;
  verify: typeof verifyToken;
}

export const referenceChambers: Chambers = { identity: verifyChallenge, trust: scoreAgent, intent: checkIntent, soul: verifyHandshake, issue: issueToken, verify: verifyToken };

export interface StepResult {
  chamber: ChamberName;
  ok: boolean;
  reason: string;
}

export interface AirlockResult {
  ok: boolean;
  stoppedAt: ChamberName | null;
  reason: string;
  steps: StepResult[];
  token?: string;
}

export async function runAirlock(req: EntryRequest, ctx: AirlockContext, chambers: Chambers = referenceChambers): Promise<AirlockResult> {
  const steps: StepResult[] = [];
  const stop = (chamber: ChamberName, reason: string): AirlockResult => {
    steps.push({ chamber, ok: false, reason });
    return { ok: false, stoppedAt: chamber, reason, steps };
  };

  const id = await chambers.identity({ challenge: req.challenge, signature: req.identitySignature, ownerAddress: ctx.ownerAddress, now: ctx.now, store: ctx.store });
  if (!id.ok) return stop('identity', id.reason);
  steps.push({ chamber: 'identity', ok: true, reason: 'ok' });

  const trust = chambers.trust(req.record, req.outside);
  if (TIER_RANK[trust.tier] < TIER_RANK[ctx.minTier]) return stop('trust', 'below_min_tier');
  steps.push({ chamber: 'trust', ok: true, reason: trust.tier });

  const intent = chambers.intent(req.intent, ctx.job, ctx.now);
  if (!intent.ok) return stop('intent', intent.reason);
  steps.push({ chamber: 'intent', ok: true, reason: 'ok' });

  const soul = await chambers.soul({ handshake: req.handshake, expectedSoul: ctx.soulSha256, expectedDid: req.challenge.did, sessionNonce: req.challenge.nonce, ownerAddress: ctx.ownerAddress });
  if (!soul.ok) return stop('soul', soul.reason);
  steps.push({ chamber: 'soul', ok: true, reason: 'ok' });

  let token: string;
  try {
    token = chambers.issue({ sub: req.challenge.did, listing: req.challenge.listingId, job: ctx.job.id, tier: trust.tier, now: ctx.now, ttlMs: ctx.sessionTtlMs, secret: ctx.sessionSecret });
  } catch {
    return stop('session', 'issue_failed');
  }
  const check = chambers.verify(token, ctx.sessionSecret, ctx.now);
  if (!check.ok) return stop('session', check.reason);
  steps.push({ chamber: 'session', ok: true, reason: 'ok' });
  return { ok: true, stoppedAt: null, reason: 'ok', steps, token };
}
