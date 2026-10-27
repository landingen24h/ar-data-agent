/**
 * LAX jobs client tests, named after the acceptance items A1 to A7.
 * Run: npx tsx --test jobs.test.ts  (A7 reads the live registry only when LAX_LIVE=1)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createJobsClient, LaxJobsError } from './src/index.js';
import type { SubmissionInput } from './src/index.js';

const BASE = 'https://reg.example/registry';
const ADDR = '0x1111111111111111111111111111111111111111';
const INPUT: SubmissionInput = {
  builder: 'Test agent',
  contact: 'ops@example.com',
  repo_or_patch_url: 'https://example.com/work.patch',
  payout_address: ADDR,
  agent_did: `did:pkh:eip155:8453:${ADDR}`,
  notes: 'M1',
};
const JOB = { id: 'job-1', title: 'A job', track: 'coding-agents', bounty_usdc: 50, deadline: '2026-11-01T00:00:00Z', status: 'open' };

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
type Answer = Response | Error;
function script(answers: Answer[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return a.clone();
  }) as unknown as typeof globalThis.fetch;
  const client = createJobsClient({ baseUrl: BASE, fetch, sleep: async (ms) => { sleeps.push(ms); } });
  return { client, calls, sleeps };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function rejects(p: Promise<unknown>, status: number, code: string, message?: RegExp) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof LaxJobsError, `expected LaxJobsError, got ${String(e)}`);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    if (message) assert.match(e.message, message);
    return;
  }
  assert.fail('expected a rejection');
}

test('A1 listJobs, getJob and submit send the right requests and return the parsed answers', async (t) => {
  await t.test('listJobs with no parameters', async () => {
    const { client, calls } = script([json({ jobs: [JOB], count: 1 })]);
    assert.deepEqual(await client.listJobs(), { jobs: [JOB], count: 1 });
    assert.equal(calls[0]!.url, `${BASE}/jobs`);
    assert.equal(calls[0]!.method, 'GET');
  });
  await t.test('listJobs with only the given parameters', async () => {
    const { client, calls } = script([json({ jobs: [], count: 0 })]);
    await client.listJobs({ track: 'seat', limit: 100 });
    assert.equal(calls[0]!.url, `${BASE}/jobs?track=seat&limit=100`);
    const s2 = script([json({ jobs: [], count: 0 })]);
    await s2.client.listJobs({ offset: 0 });
    assert.equal(s2.calls[0]!.url, `${BASE}/jobs?offset=0`);
  });
  await t.test('listJobs limit outside 1 to 100 is refused before any request', async () => {
    for (const limit of [0, 101, 1.5]) {
      const { client, calls } = script([json({ jobs: [], count: 0 })]);
      await rejects(client.listJobs({ limit }), 0, 'invalid_input');
      assert.equal(calls.length, 0);
    }
  });
  await t.test('getJob URL encodes the id and takes the job out of {job}', async () => {
    const { client, calls } = script([json({ job: JOB })]);
    assert.deepEqual(await client.getJob('a b/c'), JOB);
    assert.equal(calls[0]!.url, `${BASE}/jobs/a%20b%2Fc`);
  });
  await t.test('submit posts JSON and takes the submission out of {submission}', async () => {
    const sub = { id: 's1', job_id: 'job-1', status: 'received', created_at: '2026-10-23T12:00:00Z' };
    const { client, calls } = script([json({ submission: sub }, 201)]);
    assert.deepEqual(await client.submit('job-1', INPUT), sub);
    assert.equal(calls[0]!.url, `${BASE}/jobs/job-1/submissions`);
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.headers['content-type'], 'application/json');
    assert.deepEqual(calls[0]!.body, INPUT);
  });
  await t.test('the default base URL is the LAX registry', async () => {
    const calls: string[] = [];
    const client = createJobsClient({ fetch: (async (u: string) => { calls.push(String(u)); return json({ jobs: [], count: 0 }); }) as unknown as typeof fetch });
    await client.listJobs();
    assert.equal(calls[0], 'https://lax.kognai.ai/registry/jobs');
  });
  await t.test('an answer that is not JSON gives invalid_response', async () => {
    const { client } = script([new Response('<html>', { status: 200 })]);
    await rejects(client.getJob('x'), 200, 'invalid_response');
  });
});

test('A2 a 400, 404 or 409 throws LaxJobsError with status, code and message after a single request', async () => {
  const cases: Array<[number, string, () => (c: ReturnType<typeof createJobsClient>) => Promise<unknown>]> = [
    [400, 'bad_request', () => (c) => c.submit('job-1', INPUT)],
    [404, 'not_found', () => (c) => c.getJob('nope')],
    [409, 'conflict', () => (c) => c.submit('job-1', INPUT)],
    [400, 'bad_request', () => (c) => c.listJobs({ track: 'x' })],
  ];
  for (const [status, code, make] of cases) {
    const { client, calls, sleeps } = script([json({ error: `registry says ${status}` }, status), json({ job: JOB })]);
    await rejects(make()(client), status, code, new RegExp(`registry says ${status}`));
    assert.equal(calls.length, 1, `${status} must not be retried`);
    assert.deepEqual(sleeps, []);
  }
});

test('A3 a 429 is retried after its Retry-After, and a 429 that never ends throws rate_limited', async (t) => {
  await t.test('read: Retry-After 3 then success', async () => {
    const { client, calls, sleeps } = script([json({ error: 'slow down' }, 429, { 'retry-after': '3' }), json({ job: JOB })]);
    assert.deepEqual(await client.getJob('job-1'), JOB);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [3000]);
  });
  await t.test('submit: 429 is retried', async () => {
    const sub = { id: 's1', job_id: 'job-1', status: 'received', created_at: 'x' };
    const { client, calls, sleeps } = script([json({ error: 'slow' }, 429, { 'retry-after': '1' }), json({ submission: sub }, 201)]);
    assert.deepEqual(await client.submit('job-1', INPUT), sub);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [1000]);
  });
  await t.test('Retry-After is capped at 30 seconds, and without it the wait is 500 ms doubled', async () => {
    const a = script([json({}, 429, { 'retry-after': '600' }), json({ jobs: [], count: 0 })]);
    await a.client.listJobs();
    assert.deepEqual(a.sleeps, [30000]);
    const b = script([json({}, 429), json({}, 429), json({ jobs: [], count: 0 })]);
    await b.client.listJobs();
    assert.deepEqual(b.sleeps, [500, 1000]);
  });
  await t.test('never ending 429: the last retry throws rate_limited', async () => {
    const { client, calls } = script([json({ error: 'too many submissions' }, 429, { 'retry-after': '1' })]);
    await rejects(client.submit('job-1', INPUT), 429, 'rate_limited', /too many submissions/);
    assert.equal(calls.length, 3);
  });
  await t.test('the retries option sets the extra attempts', async () => {
    const calls: number[] = [];
    const client = createJobsClient({ baseUrl: BASE, retries: 0, sleep: async () => {}, fetch: (async () => { calls.push(1); return json({}, 429); }) as unknown as typeof fetch });
    await rejects(client.listJobs(), 429, 'rate_limited');
    assert.equal(calls.length, 1);
  });
});

test('A4 a 5xx or network error on a read is retried then throws server or network; submit is not retried on them', async (t) => {
  await t.test('5xx then success', async () => {
    const { client, calls, sleeps } = script([json({ error: 'boom' }, 503), json({ job: JOB })]);
    assert.deepEqual(await client.getJob('job-1'), JOB);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [500]);
  });
  await t.test('5xx every time throws server after 3 requests', async () => {
    const { client, calls, sleeps } = script([json({ error: 'upstream down' }, 500)]);
    await rejects(client.listJobs(), 500, 'server', /upstream down/);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [500, 1000]);
  });
  await t.test('network error every time throws network with status 0', async () => {
    const { client, calls } = script([new TypeError('fetch failed')]);
    await rejects(client.getJob('job-1'), 0, 'network', /fetch failed/);
    assert.equal(calls.length, 3);
  });
  await t.test('network error then success', async () => {
    const { client } = script([new TypeError('fetch failed'), json({ jobs: [JOB], count: 1 })]);
    assert.equal((await client.listJobs()).count, 1);
  });
  await t.test('submit is not retried on 5xx or network errors', async () => {
    const a = script([json({ error: 'boom' }, 502), json({ submission: {} }, 201)]);
    await rejects(a.client.submit('job-1', INPUT), 502, 'server');
    assert.equal(a.calls.length, 1);
    const b = script([new TypeError('fetch failed'), json({ submission: {} }, 201)]);
    await rejects(b.client.submit('job-1', INPUT), 0, 'network');
    assert.equal(b.calls.length, 1);
  });
});

test('A5 submit refuses bad input before any request, with code invalid_input', async () => {
  const bad: Array<[Partial<SubmissionInput> & Record<string, unknown>, RegExp]> = [
    [{ agent_did: undefined }, /agent_did/],
    [{ agent_did: 'agent-1' }, /agent_did/],
    [{ payout_address: '0x123' }, /payout_address/],
    [{ payout_address: `0x${'z'.repeat(40)}` }, /payout_address/],
    [{ repo_or_patch_url: 'http://example.com/a.patch' }, /https/],
    [{ repo_or_patch_url: 'not a link' }, /https/],
  ];
  for (const [over, re] of bad) {
    const { client, calls } = script([json({ submission: {} }, 201)]);
    await rejects(client.submit('job-1', { ...INPUT, ...over } as SubmissionInput), 0, 'invalid_input', re);
    assert.equal(calls.length, 0, JSON.stringify(over));
  }
});

test('A6 no new runtime dependency and no console output from the client', async () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
  assert.deepEqual(pkg.dependencies ?? {}, {});
  const src = readFileSync(new URL('./src/jobs.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'jobs.ts imports nothing');
  assert.doesNotMatch(src, /console\./);
  const seen: unknown[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  console.log = console.error = console.warn = console.info = console.debug = (...a: unknown[]) => { seen.push(a); };
  try {
    const { client } = script([json({ error: 'x' }, 500), new TypeError('fetch failed'), json({ jobs: [], count: 0 })]);
    await client.listJobs();
    await rejects(script([json({ error: 'x' }, 404)]).client.getJob('x'), 404, 'not_found');
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(seen, []);
});

test('A7 integration: the live GET /jobs', { skip: process.env.LAX_LIVE === '1' ? false : 'set LAX_LIVE=1 to read the live registry' }, async () => {
  const client = createJobsClient();
  const { jobs, count } = await client.listJobs({ limit: 5 });
  assert.ok(Array.isArray(jobs));
  assert.equal(typeof count, 'number');
  if (jobs[0]) {
    const one = await client.getJob(jobs[0].id);
    assert.equal(one.id, jobs[0].id);
  }
});
