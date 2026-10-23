import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export const STEPS = ['listing', 'airlock', 'bid', 'selection', 'award', 'delivery', 'review', 'payment'] as const;
export type Step = (typeof STEPS)[number];

export interface TenderEvent {
  type: Step;
  /** ISO 8601 UTC time, for example 2026-10-23T14:00:00Z. */
  at: string;
  /** The job the step belongs to. Required for every step except listing. */
  jobId?: string;
  /** The agent (listing id) the step is about. Required for listing, airlock, bid, award and delivery. */
  agentId?: string;
  bidId?: string;
  /** airlock: pass or fail. review: accepted or rejected. */
  decision?: 'pass' | 'fail' | 'accepted' | 'rejected';
  amountUsdc?: number;
  /** payment: on chain transaction hash. */
  tx?: string;
  note?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const TX = /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/;
const NEEDS_AGENT: Step[] = ['listing', 'airlock', 'bid', 'award', 'delivery'];
const NEEDS_BID: Step[] = ['bid', 'selection', 'award'];
const KEYS = new Set(['type', 'at', 'jobId', 'agentId', 'bidId', 'decision', 'amountUsdc', 'tx', 'note']);

/** Throws with a clear message when the event is not valid. Returns a clean copy with only known fields. */
export function validate(e: unknown): TenderEvent {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('event: expected an object');
  const ev = e as Record<string, unknown>;
  for (const k of Object.keys(ev)) if (!KEYS.has(k)) throw new Error(`event: unknown field ${k}`);
  if (!STEPS.includes(ev.type as Step)) throw new Error(`type: expected one of ${STEPS.join(', ')}`);
  const type = ev.type as Step;
  if (typeof ev.at !== 'string' || !ISO.test(ev.at) || Number.isNaN(Date.parse(ev.at))) throw new Error('at: expected ISO 8601 UTC time');
  for (const k of ['jobId', 'agentId', 'bidId'] as const) if (ev[k] !== undefined && (typeof ev[k] !== 'string' || !ID.test(ev[k] as string))) throw new Error(`${k}: bad id`);
  if (type !== 'listing' && !ev.jobId) throw new Error(`${type}: jobId is required`);
  if (NEEDS_AGENT.includes(type) && !ev.agentId) throw new Error(`${type}: agentId is required`);
  if (NEEDS_BID.includes(type) && !ev.bidId) throw new Error(`${type}: bidId is required`);
  if (type === 'airlock' && ev.decision !== 'pass' && ev.decision !== 'fail') throw new Error('airlock: decision must be pass or fail');
  if (type === 'review' && ev.decision !== 'accepted' && ev.decision !== 'rejected') throw new Error('review: decision must be accepted or rejected');
  if (type !== 'airlock' && type !== 'review' && ev.decision !== undefined) throw new Error(`${type}: decision is not allowed`);
  if (ev.amountUsdc !== undefined && (typeof ev.amountUsdc !== 'number' || !Number.isFinite(ev.amountUsdc) || ev.amountUsdc <= 0)) throw new Error('amountUsdc: expected a positive number');
  if (type === 'payment') {
    if (ev.amountUsdc === undefined) throw new Error('payment: amountUsdc is required');
    if (typeof ev.tx !== 'string' || !TX.test(ev.tx)) throw new Error('payment: tx must be an EVM or Solana transaction hash');
  } else if (ev.tx !== undefined) throw new Error(`${type}: tx is only for payment`);
  if (ev.note !== undefined && (typeof ev.note !== 'string' || ev.note.length > 500 || /[\r\n]/.test(ev.note))) throw new Error('note: one line, at most 500 chars');
  const out: Record<string, unknown> = {};
  for (const k of KEYS) if (ev[k] !== undefined) out[k] = ev[k];
  return out as unknown as TenderEvent;
}

export interface Sink { append(line: string): void; lines(): string[] }

/** Append only sink in memory (tests, one process). */
export function memorySink(): Sink {
  const store: string[] = [];
  return { append: (l) => void store.push(l), lines: () => [...store] };
}

/** Append only JSONL file. Opens with the append flag only, so existing lines are never rewritten. */
export function fileSink(path: string): Sink {
  return {
    append: (l) => appendFileSync(path, l + '\n', { flag: 'a' }),
    lines: () => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []),
  };
}

/** A writer whose emit validates and appends one JSON line. Events must not go back in time. */
export function createWriter(sink: Sink) {
  let last = '';
  for (const l of sink.lines()) last = (JSON.parse(l) as TenderEvent).at;
  return {
    emit(event: TenderEvent): TenderEvent {
      const ev = validate(event);
      if (last && Date.parse(ev.at) < Date.parse(last)) throw new Error('at: events are append only and cannot go back in time');
      sink.append(JSON.stringify(ev));
      last = ev.at;
      return ev;
    },
  };
}

/** Parse a JSONL stream; bad lines are reported, not dropped silently. */
export function readEvents(lines: string[]): { events: TenderEvent[]; bad: number[] } {
  const events: TenderEvent[] = []; const bad: number[] = [];
  lines.forEach((l, i) => { try { events.push(validate(JSON.parse(l))); } catch { bad.push(i + 1); } });
  return { events, bad };
}

/** Markdown section for one UTC day (YYYY-MM-DD): a count per step and the anomalies. History before the day is used to find anomalies. */
export function reportSection(events: TenderEvent[], day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day: expected YYYY-MM-DD');
  const end = Date.parse(day + 'T00:00:00Z') + 86400000;
  if (Number.isNaN(end)) throw new Error('day: invalid');
  const upTo = events.filter((e) => Date.parse(e.at) < end);
  const today = upTo.filter((e) => e.at.startsWith(day));
  const counts = STEPS.map((s) => [s, today.filter((e) => e.type === s).length] as const);
  const key = (e: TenderEvent) => `${e.jobId}|${e.agentId ?? ''}`;
  const airlock = new Set(upTo.filter((e) => e.type === 'airlock' && e.decision === 'pass').map(key));
  const failed = new Set(upTo.filter((e) => e.type === 'airlock' && e.decision === 'fail').map(key));
  const accepted = new Set(upTo.filter((e) => e.type === 'review' && e.decision === 'accepted').map((e) => e.jobId));
  const bids = new Set(upTo.filter((e) => e.type === 'bid').map((e) => `${e.jobId}|${e.bidId}`));
  const delivered = new Set(upTo.filter((e) => e.type === 'delivery').map((e) => e.jobId));
  const anomalies: string[] = [];
  for (const e of today) {
    if (e.type === 'bid' && !airlock.has(key(e))) anomalies.push(`bid ${e.bidId} on job ${e.jobId} by ${e.agentId} ${failed.has(key(e)) ? 'after a failed airlock' : 'without an airlock decision'}`);
    if (e.type === 'payment' && !accepted.has(e.jobId)) anomalies.push(`payment of ${e.amountUsdc} USDC on job ${e.jobId} without acceptance`);
    if ((e.type === 'selection' || e.type === 'award') && !bids.has(`${e.jobId}|${e.bidId}`)) anomalies.push(`${e.type} of bid ${e.bidId} on job ${e.jobId} without that bid`);
    if (e.type === 'review' && !delivered.has(e.jobId)) anomalies.push(`review on job ${e.jobId} without a delivery`);
  }
  const lines = [`## Tender activity ${day}`, '', '| Step | Count |', '| --- | ---: |', ...counts.map(([s, n]) => `| ${s} | ${n} |`), `| total | ${today.length} |`, ''];
  const paid = today.filter((e) => e.type === 'payment').reduce((a, e) => a + (e.amountUsdc ?? 0), 0);
  if (paid) lines.push(`Paid: ${Math.round(paid * 100) / 100} USDC.`, '');
  lines.push(`### Anomalies (${anomalies.length})`, '', ...(anomalies.length ? anomalies.map((a) => `* ${a}`) : ['None.']));
  return lines.join('\n') + '\n';
}
