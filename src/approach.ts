import { TEST_PATTERNS, NO_TEST_PATTERNS } from './rules.ts';

export interface ApproachFacts {
  hasTests: boolean;
  /** Acceptance items named in the approach, sorted, unique. */
  itemsNamed: string[];
  /** Number of distinct test signals found. */
  testSignals: number;
}

/** Reads what an approach promises. Pure text checks, no model call. */
export function readApproach(md: string, acceptance: string[] = []): ApproachFacts {
  const text = typeof md === 'string' ? md : '';
  const negated = NO_TEST_PATTERNS.some((p) => p.test(text));
  const testSignals = negated ? 0 : TEST_PATTERNS.filter((p) => p.test(text)).length;
  const ids = acceptance.length ? acceptance : [];
  const named = new Set<string>();
  for (const id of ids) {
    const re = new RegExp(`\\b${id.replace(/[^A-Za-z0-9]/g, '')}\\b`);
    if (re.test(text)) named.add(id);
  }
  if (!ids.length) {
    for (const m of text.matchAll(/\bA([1-9][0-9]?)\b/g)) named.add(`A${m[1]}`);
  }
  return { hasTests: testSignals > 0, itemsNamed: [...named].sort(), testSignals };
}
