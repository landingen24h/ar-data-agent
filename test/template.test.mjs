import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRun, runTemplate, parseCost, extractSources } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = JSON.parse(readFileSync(join(root, 'kognai-template.json'), 'utf8'));
// recorded from STARTER_TEMPLATES in @kognai/build 0.7.10 dist/templates/index.js
const engineTpl = JSON.parse(readFileSync(join(root, 'test/fixtures/engine-template-0.7.10.json'), 'utf8'));
// the footer @kognai/build 0.7.10 prints, with its colour codes
const FOOTER = '\n   \u001b[90mTotal: 48.2s \u00b7 6 model calls \u00b7 $0.0412\u001b[0m\n';
const tmp = () => mkdtemp(join(tmpdir(), 'krb-'));
const engineWrites = (files, extra = {}) => async (args) => {
  const dir = args[args.indexOf('--out-dir') + 1];
  for (const [n, c] of Object.entries(files)) { await mkdir(dirname(join(dir, n)), { recursive: true }); await writeFile(join(dir, n), c); }
  return { code: 0, stdout: 'building...' + FOOTER, stderr: '', ...extra };
};

test('A1 kognai-template.json has the engine template fields and a cost per run', () => {
  for (const k of Object.keys(engineTpl)) assert.ok(k in tpl, `missing ${k}`);
  assert.equal(typeof tpl.id, 'string'); assert.equal(typeof tpl.name, 'string'); assert.equal(typeof tpl.workflow, 'string');
  assert.ok(Array.isArray(tpl.intent) && tpl.intent.length > 0);
  assert.equal(typeof tpl.default_profile.primary, 'string'); assert.ok(Array.isArray(tpl.default_profile.secondary));
  for (const r of tpl.composition.roles) { assert.equal(typeof r.role, 'string'); assert.ok(Number.isInteger(r.count) && r.count > 0); }
  assert.ok(Array.isArray(tpl.skills) && Array.isArray(tpl.tools));
  for (const k of ['cloud_usd', 'sovereign_usd', 'measured_on', 'runs']) assert.ok(k in tpl.cost_per_run, `cost_per_run.${k}`);
  assert.equal(tpl.cost_per_run.sovereign_usd, 0);
});
test('A1 cost per run is measured on a real run', { todo: 'filled at M2 from the real cloud and sovereign runs' }, () => {
  assert.ok(tpl.cost_per_run.runs > 0 && typeof tpl.cost_per_run.cloud_usd === 'number' && tpl.cost_per_run.measured_on);
});

test('A2 planRun builds the engine arguments with the out dir, sovereign when asked, and no secret', () => {
  process.env.ANTHROPIC_API_KEY_TEST = 'sk-ant-should-never-appear';
  const a = planRun({ brief: 'Who sells pollination services in Argentina?' }, '/tmp/x').args;
  assert.equal(a[0], '--goal'); assert.match(a[1], /pollination services in Argentina/);
  assert.equal(a[a.indexOf('--out-dir') + 1], '/tmp/x/engine');
  assert.ok(!a.includes('--sovereign'));
  const s = planRun({ brief: 'x', sovereign: true }, '/tmp/y').args;
  assert.ok(s.includes('--sovereign'));
  for (const x of [...a, ...s]) assert.doesNotMatch(x, /sk-ant|api[_-]?key|token/i);
  assert.throws(() => planRun({ brief: '  ' }, '/tmp/x'), /brief is required/);
  assert.throws(() => planRun({ brief: 'x' }), /outDir is required/);
});

test('A3 runTemplate runs the engine through exec and shapes the output with the cost', async () => {
  const out = await tmp(); let seen;
  const exec = async (args) => { seen = args; return engineWrites({
    'brief.md': '## Summary\nThree firms lead.\n\n## Sources\nhttps://example.org/a\nhttps://example.org/b.',
    'notes/extra.md': 'See https://example.org/a again.',
    'empty.md': '' })(args); };
  const r = await runTemplate({ brief: 'pollination market', title: 'Pollination AR' }, { outDir: out, exec });
  assert.ok(seen.includes('--goal'));
  assert.equal(r.outDir, out); assert.equal(r.cost_usd, 0.0412);
  assert.deepEqual(r.files.map((f) => f.slice(out.length + 1)).sort(), ['brief.md', 'run.json', 'sources.md']);
  const b = await readFile(join(out, 'brief.md'), 'utf8');
  assert.match(b, /^# Research brief: Pollination AR/); assert.match(b, /Three firms lead/); assert.match(b, /## From notes\/extra.md/);
  assert.equal(await readFile(join(out, 'sources.md'), 'utf8'), '# Sources\n\n- https://example.org/a\n- https://example.org/b\n');
  const run = JSON.parse(await readFile(join(out, 'run.json'), 'utf8'));
  assert.equal(run.main, 'brief.md'); assert.equal(run.sources, 2); assert.deepEqual(run.engine_files, ['brief.md', 'notes/extra.md']);
  const sov = await runTemplate({ brief: 'x', sovereign: true }, { outDir: await tmp(), exec: engineWrites({ 'report.txt': 'plain text' }) });
  assert.equal(sov.cost_usd, 0);
  assert.equal(parseCost('no footer'), 0);
  assert.equal(parseCost('Total: 1s \u00b7 1 model calls \u00b7 $0.0100\nTotal: 2s \u00b7 2 model calls \u00b7 $0.0250'), 0.025);
  assert.deepEqual(extractSources('(https://a.io/x), https://a.io/x.'), ['https://a.io/x']);
});

test('A4 an engine failure or an empty output is rejected with a plain reason', async () => {
  await assert.rejects(runTemplate({ brief: 'x' }, { outDir: await tmp(), exec: async () => ({ code: 1, stdout: '', stderr: '\u001b[31merror:\u001b[0m ANTHROPIC_API_KEY not set' }) }),
    /the engine failed with code 1: error: ANTHROPIC_API_KEY not set/);
  await assert.rejects(runTemplate({ brief: 'x' }, { outDir: await tmp(), exec: async () => ({ code: 0, stdout: FOOTER, stderr: '' }) }), /the engine wrote no readable output/);
  await assert.rejects(runTemplate({ brief: 'x' }, { outDir: await tmp(), exec: engineWrites({ 'a.md': '  \n', 'b.png': 'x' }) }), /no readable output/);
  await assert.rejects(runTemplate({ brief: 'x' }, { outDir: await tmp(), exec: async () => { throw new Error('spawn npx ENOENT'); } }), /could not start: spawn npx ENOENT/);
});

test('A5 builds from a clean machine: lockfile, no install script, no runtime dependency', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(existsSync(join(root, 'package-lock.json')));
  for (const k of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!(pkg.scripts || {})[k], k);
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  assert.equal(pkg.scripts.test.startsWith('node --test'), true);
});

test('A6 the README states what it makes, cloud and sovereign runs and the cost per run', () => {
  const r = readFileSync(join(root, 'README.md'), 'utf8');
  for (const w of [/What it makes/, /--sovereign/, /Cost per run/i, /examples\//]) assert.match(r, w);
  assert.doesNotMatch(r, /[\u2013\u2014]/);
});
test('A6 a sample output from a real run is committed under examples/', { todo: 'committed at M2 from the real run' }, async () => {
  const f = await readdir(join(root, 'examples', 'sample'));
  assert.ok(f.includes('brief.md') && f.includes('run.json'));
});
