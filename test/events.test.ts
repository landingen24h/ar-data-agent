import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriter, memorySink, fileSink, validate, readEvents, reportSection, STEPS, type TenderEvent } from '../src/index.ts';

const TX = '0x' + 'ab'.repeat(32);
const flow: TenderEvent[] = [
  { type: 'listing', at: '2026-10-23T08:00:00Z', agentId: 'lax-ext-1' },
  { type: 'airlock', at: '2026-10-23T09:00:00Z', jobId: 'J1', agentId: 'lax-ext-1', decision: 'pass' },
  { type: 'bid', at: '2026-10-23T09:05:00Z', jobId: 'J1', agentId: 'lax-ext-1', bidId: 'B1', amountUsdc: 40 },
  { type: 'selection', at: '2026-10-23T10:00:00Z', jobId: 'J1', bidId: 'B1' },
  { type: 'award', at: '2026-10-23T10:05:00Z', jobId: 'J1', agentId: 'lax-ext-1', bidId: 'B1' },
  { type: 'delivery', at: '2026-10-23T12:00:00Z', jobId: 'J1', agentId: 'lax-ext-1' },
  { type: 'review', at: '2026-10-23T13:00:00Z', jobId: 'J1', decision: 'accepted' },
  { type: 'payment', at: '2026-10-23T13:30:00Z', jobId: 'J1', amountUsdc: 40, tx: TX },
];

test('A1 emit validates and appends one JSON line per event', () => {
  const sink = memorySink(); const w = createWriter(sink);
  for (const e of flow) w.emit(e);
  assert.equal(sink.lines().length, 8);
  assert.deepEqual(sink.lines().map((l) => JSON.parse(l).type), [...STEPS]);
});

test('A2 the stream is append only: the file keeps old lines and time cannot go back', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'ksl-')), 'events.jsonl');
  const w = createWriter(fileSink(p));
  w.emit(flow[0]); w.emit(flow[1]);
  const before = readFileSync(p, 'utf8');
  const w2 = createWriter(fileSink(p)); // a new writer on the same file keeps the history
  w2.emit(flow[2]);
  assert.ok(readFileSync(p, 'utf8').startsWith(before));
  assert.equal(readFileSync(p, 'utf8').split('\n').filter(Boolean).length, 3);
  assert.throws(() => w2.emit({ ...flow[3], at: '2026-10-23T09:00:00Z' }), /back in time/);
  assert.equal(readFileSync(p, 'utf8').split('\n').filter(Boolean).length, 3, 'a refused event writes nothing');
  assert.deepEqual(fileSink(join(tmpdir(), 'none-' + Date.now() + '.jsonl')).lines(), []);
});

test('A3 invalid events are refused and nothing is written', () => {
  const sink = memorySink(); const w = createWriter(sink);
  const bad: [unknown, RegExp][] = [
    [null, /object/], [[], /object/], [{ ...flow[0], extra: 1 }, /unknown field/], [{ ...flow[0], type: 'vote' }, /type/],
    [{ ...flow[0], at: '2026-10-23 08:00' }, /at/], [{ ...flow[0], at: '2026-13-45T99:00:00Z' }, /at/],
    [{ ...flow[1], jobId: undefined }, /jobId is required/], [{ ...flow[1], agentId: undefined }, /agentId is required/],
    [{ ...flow[2], bidId: undefined }, /bidId is required/], [{ ...flow[1], decision: 'maybe' }, /pass or fail/],
    [{ ...flow[6], decision: 'pass' }, /accepted or rejected/], [{ ...flow[2], decision: 'pass' }, /not allowed/],
    [{ ...flow[2], amountUsdc: -1 }, /positive/], [{ ...flow[7], amountUsdc: undefined }, /amountUsdc is required/],
    [{ ...flow[7], tx: 'nope' }, /transaction hash/], [{ ...flow[2], tx: TX }, /only for payment/],
    [{ ...flow[0], note: 'two\nlines' }, /one line/], [{ ...flow[1], jobId: 'bad id!' }, /bad id/],
  ];
  for (const [e, re] of bad) assert.throws(() => w.emit(e as TenderEvent), re, JSON.stringify(e));
  assert.equal(sink.lines().length, 0);
  assert.equal(validate({ ...flow[7], tx: '5'.repeat(88) }).type, 'payment', 'Solana signature accepted');
});

test('A4 the report counts each step of the day', () => {
  const md = reportSection(flow, '2026-10-23');
  for (const s of STEPS) assert.match(md, new RegExp(`\\| ${s} \\| 1 \\|`));
  assert.match(md, /\| total \| 8 \|/);
  assert.match(md, /Paid: 40 USDC/);
  assert.match(md, /### Anomalies \(0\)\n\nNone\./);
  const other = reportSection(flow, '2026-10-24');
  assert.match(other, /\| total \| 0 \|/);
  assert.doesNotMatch(other, /Paid/);
});

test('A5 anomalies: a bid without an airlock decision and a payment without acceptance', () => {
  const evs: TenderEvent[] = [
    { type: 'bid', at: '2026-10-23T09:00:00Z', jobId: 'J2', agentId: 'lax-ext-2', bidId: 'B2' },
    { type: 'airlock', at: '2026-10-23T09:10:00Z', jobId: 'J3', agentId: 'lax-ext-3', decision: 'fail' },
    { type: 'bid', at: '2026-10-23T09:20:00Z', jobId: 'J3', agentId: 'lax-ext-3', bidId: 'B3' },
    { type: 'payment', at: '2026-10-23T10:00:00Z', jobId: 'J2', amountUsdc: 10, tx: TX },
    { type: 'review', at: '2026-10-23T10:30:00Z', jobId: 'J4', decision: 'rejected' },
    { type: 'award', at: '2026-10-23T11:00:00Z', jobId: 'J4', agentId: 'lax-ext-4', bidId: 'B9' },
  ];
  const md = reportSection(evs, '2026-10-23');
  assert.match(md, /Anomalies \(5\)/);
  assert.match(md, /bid B2 on job J2 by lax-ext-2 without an airlock decision/);
  assert.match(md, /bid B3 on job J3 by lax-ext-3 after a failed airlock/);
  assert.match(md, /payment of 10 USDC on job J2 without acceptance/);
  assert.match(md, /review on job J4 without a delivery/);
  assert.match(md, /award of bid B9 on job J4 without that bid/);
});

test('A6 history from earlier days clears anomalies; later events are ignored', () => {
  const earlier = flow.slice(0, 7).map((e) => ({ ...e, at: e.at.replace('2026-10-23', '2026-10-22') }));
  const pay: TenderEvent = { ...flow[7], at: '2026-10-23T08:00:00Z' };
  assert.match(reportSection([...earlier, pay], '2026-10-23'), /Anomalies \(0\)/);
  const lateAccept: TenderEvent[] = [pay, { type: 'review', at: '2026-10-24T09:00:00Z', jobId: 'J1', decision: 'accepted' }];
  assert.match(reportSection(lateAccept, '2026-10-23'), /payment of 40 USDC on job J1 without acceptance/);
  assert.throws(() => reportSection(flow, '23/10/2026'), /YYYY-MM-DD/);
  assert.throws(() => reportSection(flow, '2026-99-99'), /invalid/);
});

test('A7 readEvents reports bad lines', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'ksl-')), 'e.jsonl');
  writeFileSync(p, JSON.stringify(flow[0]) + '\nnot json\n' + JSON.stringify({ type: 'vote' }) + '\n');
  const { events, bad } = readEvents(fileSink(p).lines());
  assert.equal(events.length, 1); assert.deepEqual(bad, [2, 3]);
});
