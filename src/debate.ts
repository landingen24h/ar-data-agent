// Golden Kog risk debate. Two advocates argue a token's structure from measured facts,
// a reviewer weighs them. Risk only: no trading view, and the debate never changes level or points.
import { ADVOCATE_MAX_WORDS, FALLBACK, REVIEWER_MAX_WORDS, problems } from './rules.ts';
export { FALLBACK, REFUSED_WORDS } from './rules.ts';

export type Role = 'sound' | 'fragile' | 'reviewer';
export interface DebateInput { facts_text: string; level: string; points: number; flag_ids: string[]; unknown: string[] }
export interface RouteArgs {
  task_type: 'risk_debate'; tier_class: 'text'; complexity: 'exec' | 'apex'; context_tokens: number;
  constitutional_flag: false; agent_id: 'golden-kog';
  payload: { role: Role; system: string; prompt: string; max_tokens: number };
}
export interface RouteResult { content: string; model?: string; cost_usd?: number }
export interface DebateDeps {
  route(args: RouteArgs): Promise<RouteResult>;
  check?(text: string): string[];
  mode?: 'off' | 'shadow' | 'on';
  log?(row: object): void;
  timeoutMs?: number;
}
export interface Debate {
  status: 'ok' | 'rejected' | 'timeout' | 'off'; shown: boolean;
  sound: string; fragile: string; reviewer: string;
  weight: string[]; unknown: string[]; tension?: string;
  models: { sound?: string; fragile?: string; reviewer?: string };
  usd: number; rejected: string[];
}

const RULES = [
  'Use only the measured facts given. Every number you write must appear in the facts exactly as written there.',
  'This is a structure risk assessment, never a trading view: no buy or sell view, no price target, no entry or exit, no advice.',
  'Do not use the words bull, bear, upside, undervalued, overvalued, accumulate, moon, take profit or any disclaimer.',
  'Latin digits only. No dash characters. Plain prose, no lists.',
].join(' ');

const SYSTEM: Record<Role, string> = {
  sound: `You argue that the token structure is sound, citing only the measured facts. At most ${ADVOCATE_MAX_WORDS} words. ${RULES}`,
  fragile: `You argue that the token structure is fragile, citing only the measured facts. At most ${ADVOCATE_MAX_WORDS} words. ${RULES}`,
  reviewer: `You weigh two structure cases against the measured facts. Answer only JSON {"text": string, "weight": string[], "unknown": string[], "tension"?: string}. text is at most ${REVIEWER_MAX_WORDS} words; weight lists the ids of the fired risk rules that matter most, chosen only from the given ids; unknown lists what the facts cannot tell; tension names the main disagreement. ${RULES}`,
};

const tokens = (s: string) => Math.ceil(s.length / 4);

function empty(status: Debate['status'], usd = 0, rejected: string[] = []): Debate {
  return { status, shown: false, sound: '', fragile: '', reviewer: '', weight: [], unknown: [], models: {}, usd, rejected };
}

function parseReviewer(content: string): { text: string; weight: string[]; unknown: string[]; tension?: string } | null {
  let s = content.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1];
  let o: unknown;
  try { o = JSON.parse(s); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.text !== 'string') return null;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  if (r.weight !== undefined && !Array.isArray(r.weight)) return null;
  if (r.unknown !== undefined && !Array.isArray(r.unknown)) return null;
  const tension = typeof r.tension === 'string' && r.tension.trim() ? r.tension : undefined;
  return { text: r.text, weight: strs(r.weight), unknown: strs(r.unknown), tension };
}

export async function debate(input: DebateInput, deps: DebateDeps): Promise<Debate> {
  const mode = deps.mode ?? 'shadow';
  if (mode === 'off') return empty('off');
  const timeoutMs = deps.timeoutMs ?? 45000;
  const spent = { usd: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((res) => { timer = setTimeout(() => res('timeout'), timeoutMs); });
  let result: Debate;
  try {
    const r = await Promise.race([run(input, deps, spent), timeout]);
    result = r === 'timeout' ? empty('timeout', spent.usd, [`no answer within ${timeoutMs} ms`]) : r;
  } finally {
    clearTimeout(timer);
  }
  result.shown = mode === 'on' && result.status === 'ok';
  if (deps.log) { try { deps.log({ ...result, mode, level: input.level, points: input.points }); } catch { /* logging never breaks the debate */ } }
  return result;
}

async function call(deps: DebateDeps, role: Role, prompt: string, spent: { usd: number }): Promise<RouteResult> {
  const system = SYSTEM[role];
  const r = await deps.route({
    task_type: 'risk_debate', tier_class: 'text', complexity: role === 'reviewer' ? 'apex' : 'exec',
    context_tokens: tokens(system) + tokens(prompt), constitutional_flag: false, agent_id: 'golden-kog',
    payload: { role, system, prompt, max_tokens: role === 'reviewer' ? 600 : 400 },
  });
  if (typeof r?.cost_usd === 'number' && Number.isFinite(r.cost_usd)) spent.usd += r.cost_usd;
  return r;
}

async function run(input: DebateInput, deps: DebateDeps, spent: { usd: number }): Promise<Debate> {
  const facts = input.facts_text;
  const ctx = `Measured facts, one per line:\n${facts}\n\nFired risk rule ids: ${input.flag_ids.join(', ') || 'none'}\nNot measured: ${input.unknown.join('; ') || 'nothing listed'}`;
  const rejected: string[] = [];
  const models: Debate['models'] = {};

  const advocate = async (role: 'sound' | 'fragile'): Promise<string> => {
    let r: RouteResult;
    try { r = await call(deps, role, `${ctx}\n\nWrite the case that the structure is ${role}.`, spent); }
    catch (e) { rejected.push(`${role}: call failed: ${(e as Error).message}`); return FALLBACK; }
    if (r.model) models[role] = r.model;
    const text = typeof r.content === 'string' ? r.content.trim() : '';
    const p = problems(text, facts, ADVOCATE_MAX_WORDS, deps.check);
    if (p.length) { for (const x of p) rejected.push(`${role}: ${x}`); return FALLBACK; }
    return text;
  };
  const [sound, fragile] = await Promise.all([advocate('sound'), advocate('fragile')]);

  let r: RouteResult;
  try { r = await call(deps, 'reviewer', `${ctx}\n\nSound case:\n${sound}\n\nFragile case:\n${fragile}\n\nWeigh them and answer the JSON.`, spent); }
  catch (e) { return empty('rejected', spent.usd, [...rejected, `reviewer: call failed: ${(e as Error).message}`]); }
  if (r.model) models.reviewer = r.model;
  const parsed = parseReviewer(typeof r.content === 'string' ? r.content : '');
  if (!parsed) return empty('rejected', spent.usd, [...rejected, 'reviewer: answer is not the expected JSON']);
  const rp = problems(parsed.text.trim(), facts, REVIEWER_MAX_WORDS, deps.check).map((x) => `reviewer: ${x}`);
  for (const extra of [parsed.tension, ...parsed.unknown]) {
    if (extra) for (const x of problems(extra, facts, REVIEWER_MAX_WORDS, deps.check)) rp.push(`reviewer: ${x}`);
  }
  if (rp.length) return empty('rejected', spent.usd, [...rejected, ...new Set(rp)]);

  const known = new Set(input.flag_ids);
  const out: Debate = {
    status: 'ok', shown: false, sound, fragile, reviewer: parsed.text.trim(),
    weight: [...new Set(parsed.weight.filter((id) => known.has(id)))], unknown: parsed.unknown,
    models, usd: spent.usd, rejected,
  };
  if (parsed.tension) out.tension = parsed.tension;
  return out;
}
