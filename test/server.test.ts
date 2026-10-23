import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLaxMcpServer } from '../src/index.js';

const BASE = 'https://reg.example/registry';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAYOUT = '0x1111111111111111111111111111111111111111';
const CONTACT = 'secret-ops@example.com';
const SUBMIT = { job_id: 'job-1', builder: 'Test agent', contact: CONTACT, repo_or_patch_url: 'https://example.com/work.patch', payout_address: PAYOUT, agent_did: 'did:pkh:eip155:8453:' + PAYOUT, notes: 'hello' };

type Call = { url: string; method: string; body?: unknown; headers: Record<string, string> };
function fakeFetch(answer: (c: Call) => Response | Promise<Response> = () => new Response(JSON.stringify({ ok: true }), { status: 200 })) {
  const calls: Call[] = [];
  const f = async (url: any, init: any = {}) => {
    const c: Call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} };
    calls.push(c);
    return answer(c);
  };
  return { f: f as unknown as typeof fetch, calls };
}

async function connect(f: typeof fetch, log?: (l: string) => void) {
  const server = createLaxMcpServer({ baseUrl: BASE, fetch: f, log });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const text = (r: any) => r.content[0].text as string;

test('A1 tools/list returns the five tools, each with a description and an input schema', async () => {
  const client = await connect(fakeFetch().f);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['lax_get_job', 'lax_get_offer', 'lax_list_jobs', 'lax_search_agents', 'lax_submit']);
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object');
  }
  const submit = tools.find((t) => t.name === 'lax_submit')!;
  assert.deepEqual(Object.keys(submit.inputSchema.properties!).sort(), ['agent_did', 'builder', 'contact', 'job_id', 'notes', 'payout_address', 'repo_or_patch_url']);
  const jobs = tools.find((t) => t.name === 'lax_list_jobs')!;
  assert.deepEqual(Object.keys(jobs.inputSchema.properties!).sort(), ['limit', 'offset', 'track']);
});

test('A2 each tool calls its registry route with the given arguments and returns the registry answer', async (t) => {
  const { f, calls } = fakeFetch((c) => new Response(JSON.stringify({ echo: c.url }), { status: 200 }));
  const client = await connect(f);
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ['lax_search_agents', { query: 'invoice & tax' }, 'GET', `${BASE}/search?query=invoice%20%26%20tax`],
    ['lax_search_agents', {}, 'GET', `${BASE}/search`],
    ['lax_get_offer', { id: 'lax-ext-676dfacaeb79' }, 'GET', `${BASE}/offers/lax-ext-676dfacaeb79`],
    ['lax_list_jobs', { track: 'coding-agents', limit: 10, offset: 20 }, 'GET', `${BASE}/jobs?track=coding-agents&limit=10&offset=20`],
    ['lax_list_jobs', {}, 'GET', `${BASE}/jobs`],
    ['lax_get_job', { id: 'a14478ee-35f7-4457-843a-482f25af6dad' }, 'GET', `${BASE}/jobs/a14478ee-35f7-4457-843a-482f25af6dad`],
    ['lax_submit', SUBMIT, 'POST', `${BASE}/jobs/job-1/submissions`],
  ];
  for (const [name, args, method, url] of cases) {
    await t.test(`${name} ${JSON.stringify(args).slice(0, 40)}`, async () => {
      const before = calls.length;
      const r: any = await client.callTool({ name, arguments: args });
      assert.equal(calls.length, before + 1);
      const c = calls[calls.length - 1];
      assert.equal(c.method, method);
      assert.equal(c.url, url);
      assert.notEqual(r.isError, true);
      assert.deepEqual(JSON.parse(text(r)), { echo: url });
      assert.deepEqual(r.structuredContent, { echo: url });
    });
  }
  await t.test('the submission body is the arguments without job_id', () => {
    const c = calls.find((x) => x.method === 'POST')!;
    const { job_id, ...rest } = SUBMIT;
    assert.deepEqual(c.body, rest);
    assert.equal(c.headers['content-type'], 'application/json');
  });
});

test('A3 a 4xx, a 5xx or a network failure gives isError with the status and message, and the next call still works', async () => {
  let mode = 'ok';
  const { f } = fakeFetch(() => {
    if (mode === '404') return new Response(JSON.stringify({ error: 'job not found' }), { status: 404 });
    if (mode === '500') return new Response('upstream exploded', { status: 500 });
    if (mode === 'net') throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
  });
  const client = await connect(f);
  mode = '404';
  let r: any = await client.callTool({ name: 'lax_get_job', arguments: { id: 'nope' } });
  assert.equal(r.isError, true); assert.match(text(r), /404/); assert.match(text(r), /job not found/);
  mode = '500';
  r = await client.callTool({ name: 'lax_list_jobs', arguments: {} });
  assert.equal(r.isError, true); assert.match(text(r), /500/); assert.match(text(r), /upstream exploded/);
  mode = 'net';
  r = await client.callTool({ name: 'lax_search_agents', arguments: { query: 'x' } });
  assert.equal(r.isError, true); assert.match(text(r), /fetch failed/);
  mode = 'ok';
  r = await client.callTool({ name: 'lax_list_jobs', arguments: {} });
  assert.notEqual(r.isError, true);
  assert.deepEqual(JSON.parse(text(r)), { jobs: [] });
});

test('A4 invalid input is refused without a request', async () => {
  const { f, calls } = fakeFetch();
  const client = await connect(f);
  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    ['lax_get_job', {}, /id is required/],
    ['lax_get_offer', { id: '' }, /id is required/],
    ['lax_get_job', { id: '../admin' }, /id must be/],
    ['lax_search_agents', { query: 'x'.repeat(101) }, /100/],
    ['lax_list_jobs', { limit: 500 }, /limit/],
    ['lax_submit', { ...SUBMIT, payout_address: '0x123' }, /payout_address/],
    ['lax_submit', { ...SUBMIT, payout_address: '0x' + 'g'.repeat(40) }, /payout_address/],
    ['lax_submit', { ...SUBMIT, repo_or_patch_url: 'http://example.com/x.patch' }, /https/],
    ['lax_submit', { ...SUBMIT, repo_or_patch_url: 'not a link' }, /https/],
    ['lax_submit', { ...SUBMIT, agent_did: 'agent-1' }, /agent_did/],
    ['lax_submit', { ...SUBMIT, job_id: undefined }, /job_id/],
  ];
  for (const [name, args, re] of bad) {
    const r: any = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.match(text(r), re);
  }
  assert.equal(calls.length, 0);
});

function mockRegistry(): Promise<{ url: string; srv: Server }> {
  return new Promise((ok) => {
    const srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, path: req.url })));
    }).listen(0, () => ok({ url: `http://127.0.0.1:${(srv.address() as any).port}/registry`, srv }));
  });
}

const CLI = ['--import', 'tsx', '-e', "import('./src/cli.ts').then((m) => m.main(process.argv.slice(1).filter((a) => a !== '--'))).catch((e) => { process.stderr.write(String(e)); process.exit(1); })"];

test('A5 no contact, payout address or header in any log line, and only protocol messages on stdout in stdio mode', async () => {
  const lines: string[] = [];
  const client = await connect(fakeFetch().f, (l) => lines.push(l));
  await client.callTool({ name: 'lax_submit', arguments: SUBMIT });
  await client.callTool({ name: 'lax_get_job', arguments: { id: 'x' } });
  assert.ok(lines.length >= 2);
  for (const l of lines) for (const s of [CONTACT, PAYOUT, 'content-type', 'accept']) assert.ok(!l.includes(s), l);

  const { url, srv } = await mockRegistry();
  const child = spawn(process.execPath, CLI, { cwd: ROOT, env: { ...process.env, LAX_BASE_URL: url }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
  const waitFor = async (n: number) => { for (let i = 0; i < 200 && out.split('\n').filter(Boolean).length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  await waitFor(1);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lax_submit', arguments: SUBMIT } });
  await waitFor(2);
  child.kill(); srv.close();
  const msgs = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(msgs.every((m) => m.jsonrpc === '2.0'), out);
  const result = msgs.find((m) => m.id === 2).result;
  assert.notEqual(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).path, '/registry/jobs/job-1/submissions');
  for (const s of [CONTACT, PAYOUT]) assert.ok(!err.includes(s), err);
});

test('A6 stdio and Streamable HTTP both work', async (t) => {
  await t.test('Streamable HTTP on --port', async () => {
    const { url, srv } = await mockRegistry();
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [...CLI, '--', '--http', '--port', String(port)], { cwd: ROOT, env: { ...process.env, LAX_BASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    for (let i = 0; i < 200 && !err.includes('ready on http'); i++) await new Promise((r) => setTimeout(r, 50));
    try {
      const post = (o: unknown) => fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(o) });
      const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      assert.equal(init.status, 200, err);
      assert.equal((await init.json()).result.serverInfo.name, 'lax-mcp-server');
      const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      assert.equal((await list.json()).result.tools.length, 5);
      const call = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lax_list_jobs', arguments: { limit: 5 } } });
      assert.equal(JSON.parse((await call.json()).result.content[0].text).path, '/registry/jobs?limit=5');
    } finally { child.kill(); srv.close(); }
  });
  await t.test('stdio is covered by A5', () => {});
  await t.test('the package declares a bin', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.bin['lax-mcp'], 'bin/lax-mcp.js');
  });
  await t.test('published to npm', { todo: 'M2: npm publish of lax-mcp-server' }, () => {});
});

test('A7 the README has the Claude Desktop config and every tool with an example', () => {
  const md = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(md, /"mcpServers"/);
  const block = md.match(/```json\n([\s\S]*?"mcpServers"[\s\S]*?)```/);
  assert.ok(block, 'a json block with mcpServers');
  assert.ok(JSON.parse(block![1]).mcpServers.lax);
  for (const name of ['lax_search_agents', 'lax_get_offer', 'lax_list_jobs', 'lax_get_job', 'lax_submit']) {
    assert.match(md, new RegExp(`### ${name}[\\s\\S]*?\`\`\`json`), name);
  }
});
