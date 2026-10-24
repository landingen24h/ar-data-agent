import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { debate, FALLBACK } from '../src/debate.ts';
import { input, fake, SOUND, FRAGILE, REVIEW } from './helpers.ts';

test('A1 advocates sound and fragile run in parallel, then the reviewer gets both texts and the facts', async () => {
  const started: string[] = []; const finished: string[] = [];
  const f = fake({}, { delay: { sound: 40, fragile: 40 } });
  const route = f.deps.route;
  f.deps.route = async (a) => { started.push(a.payload.role); const r = await route(a); finished.push(a.payload.role); return r; };
  const d = await debate(input, f.deps);
  assert.equal(d.status, 'ok');
  assert.deepEqual(f.calls.map((c) => c.payload.role), ['sound', 'fragile', 'reviewer']);
  // both advocates had started before either finished: parallel
  assert.deepEqual(started.slice(0, 2), ['sound', 'fragile']);
  assert.equal(finished.indexOf('sound') < 2 && finished.indexOf('fragile') < 2, true);
  assert.deepEqual(f.calls.map((c) => c.complexity), ['exec', 'exec', 'apex']);
  for (const c of f.calls) {
    assert.equal(c.task_type, 'risk_debate'); assert.equal(c.tier_class, 'text'); assert.equal(c.agent_id, 'golden-kog');
    assert.equal(c.constitutional_flag, false); assert.ok(c.context_tokens > 0); assert.ok(c.payload.max_tokens > 0);
  }
  const rev = f.calls[2].payload.prompt;
  assert.ok(rev.includes(SOUND) && rev.includes(FRAGILE) && rev.includes(input.facts_text));
  assert.equal(d.sound, SOUND); assert.equal(d.fragile, FRAGILE);
  assert.deepEqual(d.models, { sound: 'model-sound', fragile: 'model-fragile', reviewer: 'model-reviewer' });
});

test('A2 a number not in the facts replaces the advocate part and drops the debate on the reviewer, keeping the reason', async () => {
  const a = await debate(input, fake({ sound: 'Holders own 55 percent of supply.' }).deps);
  assert.equal(a.status, 'ok');
  assert.equal(a.sound, FALLBACK);
  assert.ok(a.rejected.some((r) => r.startsWith('sound:') && r.includes('55')));
  assert.equal(a.fragile, FRAGILE);
  // the same digits written another way is not the same number
  const b = await debate(input, fake({ fragile: 'Pool depth is 18500 USD.' }).deps);
  assert.equal(b.fragile, FALLBACK);
  const r = await debate(input, fake({ reviewer: JSON.stringify({ text: 'Concentration is 70 percent.', weight: [], unknown: [] }) }).deps);
  assert.equal(r.status, 'rejected');
  assert.equal(r.sound + r.fragile + r.reviewer, '');
  assert.ok(r.rejected.some((x) => x.startsWith('reviewer:') && x.includes('70')));
});

test('A3 refused words, long dashes, non Latin digits, too many words and check problems are refused the same way', async () => {
  const cases: [string, RegExp][] = [
    ['This looks bullish given revoked mint.', /refused word "bullish"/],
    ['A clear Entry point after the mint was revoked.', /refused word "entry"/],
    ['Mint is revoked \u2014 that limits supply.', /dash/],
    ['Mint revoked; top holders own \u0666\u0662 percent.', /non Latin digit/],
    [Array(181).fill('word').join(' '), /181 words/],
    ['Mint authority is revoked.', /check: mentions a ticker/],
  ];
  for (const [text, why] of cases) {
    const d = await debate(input, fake({ sound: text }, { check: (t) => (t.includes('Mint authority is revoked.') ? ['mentions a ticker'] : []) }).deps);
    assert.equal(d.sound, FALLBACK, text);
    assert.ok(d.rejected.some((r) => r.startsWith('sound:') && why.test(r)), `${text}: ${d.rejected.join(' | ')}`);
  }
  const ok = await debate(input, fake({}, { check: () => [] }).deps);
  assert.equal(ok.sound, SOUND); assert.deepEqual(ok.rejected, []);
  const rev = await debate(input, fake({ reviewer: JSON.stringify({ text: Array(151).fill('word').join(' '), weight: [] }) }).deps);
  assert.equal(rev.status, 'rejected'); assert.ok(rev.rejected.some((r) => /reviewer: 151 words/.test(r)));
  const rev2 = await debate(input, fake({ reviewer: JSON.stringify({ text: 'A price target is not given.' }) }).deps);
  assert.equal(rev2.status, 'rejected');
});

test('A4 the reviewer JSON is parsed, weight keeps only known flag ids, unparseable JSON is rejected', async () => {
  const d = await debate(input, fake().deps);
  assert.equal(d.status, 'ok');
  assert.deepEqual(d.weight, ['concentration', 'unlocked_liquidity']);
  assert.deepEqual(d.unknown, ['team wallets']);
  assert.equal(d.tension, 'Revoked mint against active freeze authority.');
  assert.equal(d.reviewer, JSON.parse(REVIEW).text);
  const fenced = await debate(input, fake({ reviewer: '```json\n' + REVIEW + '\n```' }).deps);
  assert.equal(fenced.status, 'ok');
  for (const bad of ['not json', '{"weight": []}', '[1,2]', '{"text": "x", "weight": "concentration"}']) {
    const r = await debate(input, fake({ reviewer: bad }).deps);
    assert.equal(r.status, 'rejected', bad);
    assert.equal(r.reviewer, ''); assert.equal(r.sound, ''); assert.equal(r.fragile, '');
    assert.ok(r.rejected.some((x) => x.startsWith('reviewer:')));
  }
});

test('A5 a call over timeoutMs gives status timeout without throwing', async () => {
  const t0 = Date.now();
  const d = await debate(input, fake({}, { delay: { reviewer: 500 }, timeoutMs: 50 }).deps);
  assert.equal(d.status, 'timeout'); assert.equal(d.shown, false);
  assert.ok(Date.now() - t0 < 400);
  assert.equal(d.sound, ''); assert.equal(d.reviewer, '');
  assert.ok(Math.abs(d.usd - 0.002) < 1e-9, 'the two advocate calls that finished are counted');
  const e = await debate(input, fake({ reviewer: new Error('router down') }).deps);
  assert.equal(e.status, 'rejected');
});

test('A6 mode off makes no call, shadow logs and returns shown false, on returns shown true, usd sums the calls', async () => {
  const off = fake({}, { mode: 'off' });
  const o = await debate(input, off.deps);
  assert.equal(o.status, 'off'); assert.equal(off.calls.length, 0); assert.equal(o.shown, false);
  const sh = fake({}, { cost: 0.0125 });
  const s = await debate(input, sh.deps); // default mode is shadow
  assert.equal(s.status, 'ok'); assert.equal(s.shown, false); assert.equal(sh.calls.length, 3);
  assert.equal(sh.log.length, 1); assert.equal((sh.log[0] as { sound: string }).sound, SOUND);
  assert.ok(Math.abs(s.usd - 0.0375) < 1e-9);
  const on = await debate(input, fake({}, { mode: 'on' }).deps);
  assert.equal(on.shown, true);
  // the debate never returns or changes a level or points
  assert.equal('level' in on || 'points' in on, false);
  assert.equal(input.level, 'high'); assert.equal(input.points, 71);
});

test('A7 the README shows the call flow, the rules, an example Debate and credits TradingAgents', () => {
  const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(r, /## Call flow/); assert.match(r, /## Rules/); assert.match(r, /## Example Debate/);
  assert.match(r, /TradingAgents/); assert.match(r, /TauricResearch/); assert.match(r, /Apache 2\.0/);
  assert.match(r, /"status": "ok"/);
  assert.doesNotMatch(r, /[\u2013\u2014]/);
});
