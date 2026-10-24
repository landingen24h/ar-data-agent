// Text rules every part of the debate must pass. Pure functions, no dependency.

export const REFUSED_WORDS = [
  'bull', 'bear', 'bullish', 'bearish', 'upside', 'downside target', 'undervalued', 'overvalued',
  'accumulate', 'moon', 'buy now', 'sell now', 'price target', 'entry', 'exit', 'take profit',
  'not financial advice',
] as const;

export const ADVOCATE_MAX_WORDS = 180;
export const REVIEWER_MAX_WORDS = 150;
export const FALLBACK = 'No case could be written from the measured facts.';

const NUMBER = /\d+(?:[.,]\d+)*/g;
// figure dash, en dash, em dash, horizontal bar, hyphen and non breaking hyphen variants, two and three em dash, small and full width dashes, minus sign
const DASH = /[\u2010-\u2015\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/;
const ANY_DIGIT = /\p{Nd}/gu;
const REFUSED = REFUSED_WORDS.map((w) => ({ w, re: new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`, 'i') }));

export function numbersIn(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Problems of one part; an empty list means the part may be shown. */
export function problems(text: string, factsText: string, maxWords: number, check?: (t: string) => string[]): string[] {
  const out: string[] = [];
  if (!text.trim()) out.push('empty text');
  const known = new Set(numbersIn(factsText));
  for (const n of new Set(numbersIn(text))) if (!known.has(n)) out.push(`number ${n} is not in the measured facts`);
  for (const { w, re } of REFUSED) if (re.test(text)) out.push(`refused word "${w}"`);
  if (DASH.test(text)) out.push('dash character');
  for (const d of new Set(text.match(ANY_DIGIT) ?? [])) if (!/[0-9]/.test(d)) { out.push('non Latin digit'); break; }
  const words = wordCount(text);
  if (words > maxWords) out.push(`${words} words, over the limit of ${maxWords}`);
  if (check) {
    try { for (const p of check(text) ?? []) out.push(`check: ${p}`); }
    catch (e) { out.push(`check failed: ${(e as Error).message}`); }
  }
  return out;
}
