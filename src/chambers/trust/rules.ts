import type { Tier } from './types.ts';

/** Points per part of the record. They add up to 100. */
export const WEIGHTS = {
  age: 10,
  deliveries: 40,
  admission: 20,
  aiax: 10,
  acp: 20,
} as const;

/** Days of listing age that earn the full age points. */
export const AGE_FULL_DAYS = 90;
/** Accepted deliveries that earn the full delivery volume. */
export const DELIVERIES_FULL = 5;

/** Lowest score of each tier. A score under 25 is unproven. */
export const TIER_FLOOR: Record<Exclude<Tier, 'unproven'>, number> = {
  bronze: 25,
  silver: 50,
  gold: 75,
};

export const TIERS: Tier[] = ['unproven', 'bronze', 'silver', 'gold'];

/** Weight of the outside score in the blended score. */
export const OUTSIDE_WEIGHT = 0.2;

export function tierOf(score: number): Tier {
  if (score >= TIER_FLOOR.gold) return 'gold';
  if (score >= TIER_FLOOR.silver) return 'silver';
  if (score >= TIER_FLOOR.bronze) return 'bronze';
  return 'unproven';
}

/** A finite number at or above 0, else 0. */
export function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** A number clamped to 0..100, or null when it is not a finite number. */
export function percent(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
