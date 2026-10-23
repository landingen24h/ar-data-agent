import type { AgentRecord, OutsideScore, TrustResult, Tier } from './types.ts';
import { WEIGHTS, AGE_FULL_DAYS, DELIVERIES_FULL, TIERS, OUTSIDE_WEIGHT, tierOf, count, percent, round2 } from './rules.ts';

/**
 * Cerberus chamber 2. Scores an agent from its LAX and ACP record.
 * Pure: no clock, no network, no randomness. Never throws and never refuses:
 * an agent with no record gets score 0 and the tier unproven.
 */
export function scoreAgent(record: AgentRecord | null | undefined, outside?: OutsideScore | null): TrustResult {
  const r: AgentRecord = record && typeof record === 'object' ? record : {};
  const reasons: string[] = [];
  let score = 0;

  // Listing age
  const age = Math.floor(count(r.listing_age_days));
  const agePts = (Math.min(age, AGE_FULL_DAYS) / AGE_FULL_DAYS) * WEIGHTS.age;
  score += agePts;
  reasons.push(`listing age ${age} days: ${round2(agePts)} of ${WEIGHTS.age} points`);

  // Deliveries: acceptance rate times volume
  const acc = Math.floor(count(r.accepted_deliveries));
  const rej = Math.floor(count(r.rejected_deliveries));
  let delPts = 0;
  if (acc + rej > 0) {
    const rate = acc / (acc + rej);
    const volume = Math.min(acc, DELIVERIES_FULL) / DELIVERIES_FULL;
    delPts = rate * volume * WEIGHTS.deliveries;
  }
  score += delPts;
  reasons.push(`${acc} accepted and ${rej} rejected deliveries: ${round2(delPts)} of ${WEIGHTS.deliveries} points`);

  // Admission test
  const adm = r.admission_test === 'passed' ? WEIGHTS.admission : 0;
  score += adm;
  reasons.push(`admission test ${r.admission_test === 'passed' || r.admission_test === 'failed' ? r.admission_test : 'not taken'}: ${adm} of ${WEIGHTS.admission} points`);

  // AIAX readiness
  const aiax = r.aiax_ready === true ? WEIGHTS.aiax : 0;
  score += aiax;
  reasons.push(`AIAX manifest ${r.aiax_ready === true ? 'ready' : 'not ready'}: ${aiax} of ${WEIGHTS.aiax} points`);

  // ACP score
  const acp = percent(r.acp_score);
  const acpPts = acp === null ? 0 : (acp / 100) * WEIGHTS.acp;
  score += acpPts;
  reasons.push(acp === null ? `no ACP score: 0 of ${WEIGHTS.acp} points` : `ACP score ${acp}: ${round2(acpPts)} of ${WEIGHTS.acp} points`);

  const own = round2(score);
  // No accepted delivery and no passed admission test: nothing proven yet.
  const proven = acc > 0 || r.admission_test === 'passed';
  let tier: Tier = proven ? tierOf(own) : 'unproven';
  if (!proven) reasons.push('no accepted delivery and no passed admission test: tier unproven, not refused');
  let final = own;

  const out = outside ? percent(outside.score) : null;
  if (out !== null) {
    const src = typeof outside?.source === 'string' && outside.source.trim() ? outside.source.trim().slice(0, 40) : 'outside source';
    const wRaw = outside?.weight;
    const w = typeof wRaw === 'number' && Number.isFinite(wRaw) ? Math.min(1, Math.max(0, wRaw)) : OUTSIDE_WEIGHT;
    final = round2(own * (1 - w) + out * w);
    if (proven) {
      const ownIdx = TIERS.indexOf(tier);
      const want = TIERS.indexOf(tierOf(final));
      // The second opinion may move the tier by one step at most.
      const idx = Math.max(ownIdx - 1, Math.min(ownIdx + 1, want));
      if (idx !== want) reasons.push(`outside score limited to one tier step`);
      tier = TIERS[idx];
    }
    reasons.push(`outside score ${out} from ${src}, weight ${round2(w * 100)} percent: blended score ${final}`);
  }

  return { score: Math.min(100, Math.max(0, final)), tier, reasons };
}
