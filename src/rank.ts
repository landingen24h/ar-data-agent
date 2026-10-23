import type { Bundle, Bid, Records, RankedBid, Tier } from './types.ts';
import { WEIGHTS, TIER_POINTS, round2, num, count } from './rules.ts';
import { readApproach } from './approach.ts';

interface Scored {
  bid_id: string;
  score: number;
  price: number;
  valid: boolean;
  hasTests: boolean;
  reason: string;
}

const TIERS: Tier[] = ['unproven', 'bronze', 'silver', 'gold'];

function scoreBid(bundle: Bundle, bid: Bid, records: Records): Scored {
  const id = String(bid?.bid_id ?? '');
  const ceiling = num(bundle?.ceiling_usdc);
  const price = num(bid?.price_usdc);
  const problems: string[] = [];
  if (!(ceiling > 0)) problems.push('the bundle has no valid ceiling');
  if (!(price > 0)) problems.push('the price is missing or not positive');
  else if (price > ceiling) problems.push(`the price of ${price} USDC is above the ceiling of ${ceiling} USDC`);
  if (bundle?.deadline && bid?.delivery_by) {
    const d = Date.parse(bid.delivery_by), dl = Date.parse(bundle.deadline);
    if (Number.isFinite(d) && Number.isFinite(dl) && d > dl) problems.push('the delivery date is after the bundle deadline');
  }
  const facts = readApproach(bid?.approach_md ?? '', bundle?.acceptance ?? []);

  if (problems.length) {
    return {
      bid_id: id, score: 0, price: Number.isFinite(price) ? price : Number.POSITIVE_INFINITY, valid: false, hasTests: facts.hasTests,
      reason: `This bid cannot be selected because ${problems.join(' and ')}, so it scores 0 and ranks after every valid bid.`,
    };
  }

  // Price: the further under the ceiling, the more points.
  const pricePts = ((ceiling - price) / ceiling) * WEIGHTS.price;
  // Tests: all or nothing, so a cheap bid with no tests cannot win on price alone.
  const testPts = facts.hasTests ? WEIGHTS.tests : 0;
  // Scope: share of the acceptance items the approach names.
  const total = bundle.acceptance?.length ?? 0;
  const scopePts = total > 0 ? (facts.itemsNamed.length / total) * WEIGHTS.scope : Math.min(facts.itemsNamed.length, 3) / 3 * WEIGHTS.scope;
  // Record: accepted share times volume (full at 5 accepted).
  const rec = records?.[bid.agent_id] ?? {};
  const acc = count(rec.accepted_deliveries), rej = count(rec.rejected_deliveries);
  const recordPts = acc + rej > 0 ? (acc / (acc + rej)) * (Math.min(acc, 5) / 5) * WEIGHTS.record : 0;
  const tier: Tier = rec.tier && TIERS.includes(rec.tier) ? rec.tier : 'unproven';
  const tierPts = TIER_POINTS[tier];

  const score = round2(pricePts + testPts + scopePts + recordPts + tierPts);
  const scopeText = total > 0 ? `${facts.itemsNamed.length} of ${total} acceptance items` : `${facts.itemsNamed.length} acceptance items`;
  const reason =
    `Price ${price} USDC against a ceiling of ${ceiling} gives ${round2(pricePts)} points; ` +
    `${facts.hasTests ? 'the approach ships tests' : 'the approach names no tests'} for ${testPts} points; ` +
    `it covers ${scopeText} for ${round2(scopePts)} points; ` +
    `the agent has ${acc} accepted and ${rej} rejected deliveries for ${round2(recordPts)} points; ` +
    `its Cerberus tier is ${tier} for ${tierPts} points.`;
  return { bid_id: id, score, price, valid: true, hasTests: facts.hasTests, reason };
}

/**
 * Ranks tender bids. Pure and deterministic: the same input always gives the same output,
 * whatever the order of the bids. Ties break on lower price, then on bid_id.
 */
export function rankBids(bundle: Bundle, bids: Bid[], records: Records = {}): RankedBid[] {
  const list = Array.isArray(bids) ? bids : [];
  const scored = list.map((b) => scoreBid(bundle, b, records));
  scored.sort((a, b) =>
    Number(b.valid) - Number(a.valid) ||
    b.score - a.score ||
    a.price - b.price ||
    (a.bid_id < b.bid_id ? -1 : a.bid_id > b.bid_id ? 1 : 0),
  );
  return scored.map((s, i) => ({ bid_id: s.bid_id, rank: i + 1, score: s.score, reason: s.reason }));
}
