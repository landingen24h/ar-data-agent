import type { Tier } from './types.ts';

/** Points per criterion. They add up to 100. Tests outweigh the whole price score on purpose. */
export const WEIGHTS = {
  price: 20,
  tests: 25,
  scope: 15,
  record: 20,
  tier: 20,
} as const;

export const TIER_POINTS: Record<Tier, number> = { unproven: 0, bronze: 8, silver: 14, gold: 20 };

/** Words that show an approach ships tests. */
export const TEST_PATTERNS: RegExp[] = [
  /\btests?\b/i,
  /\bunit tests?\b/i,
  /\bnode:test\b/i,
  /\b(vitest|jest|mocha|pytest|tsx --test|npm test)\b/i,
  /\btest (suite|cases?|fixtures?)\b/i,
  /\bfixtures?\b/i,
];

/** Phrases that say the opposite. */
export const NO_TEST_PATTERNS: RegExp[] = [/\bno tests?\b/i, /\bwithout tests?\b/i, /\btests? (are|is) not (included|needed)\b/i, /\bskip(ping)? tests?\b/i];

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function num(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : Number.NaN;
}

export function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
