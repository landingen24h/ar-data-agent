// Research brief product template on the Kognai engine (@kognai/build 0.7 or later).
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export const ENGINE_DIR = 'engine';
const TEXT = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.json', '.ts', '.js', '.csv']);
const ANSI = /\u001b\[[0-9;]*m/g;

/** Turn the brief into the goal text given to the engine. */
export function goalFor(input) {
  const brief = String(input.brief).replace(/\s+/g, ' ').trim();
  const audience = input.audience ? ` The reader is ${String(input.audience).trim()}.` : '';
  const lang = input.language ? ` Write it in ${String(input.language).trim()}.` : '';
  return `Write a research brief in Markdown as the file brief.md answering: ${brief}.${audience}${lang} ` +
    'Sections: Summary (5 lines at most), Key findings (bullets, each with its source), Open questions, Sources (one URL per line). ' +
    'State only facts you can attribute; mark anything uncertain as uncertain. No investment, legal or medical advice.';
}

/** Build the @kognai/build arguments for one run. Never includes a key. */
export function planRun(input, outDir) {
  if (!input || typeof input.brief !== 'string' || !input.brief.trim()) throw new Error('brief is required');
  if (!outDir) throw new Error('outDir is required');
  const args = ['--goal', goalFor(input), '--out-dir', join(outDir, ENGINE_DIR), '--profile', 'quality'];
  if (input.sovereign) args.push('--sovereign');
  return { args };
}

/** Default exec: runs npx @kognai/build with the arguments. Keys come only from the caller's environment. */
export function npxExec(args) {
  return new Promise((resolve) => {
    const p = spawn('npx', ['-y', '@kognai/build@>=0.7.0', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => resolve({ code: 127, stdout, stderr: stderr + String(e.message) }));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Read the total cost the engine prints (Total: ... · N model calls · $0.0123). Last one wins. */
export function parseCost(stdout) {
  const m = [...String(stdout).replace(ANSI, '').matchAll(/Total:[^\n$]*\$(\d+(?:\.\d+)?)/g)];
  return m.length ? Number(m[m.length - 1][1]) : 0;
}

async function walk(dir) {
  let out = [];
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) out = out.concat(await walk(p)); }
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export function extractSources(text) {
  const seen = new Set();
  for (const m of String(text).matchAll(/https?:\/\/[^\s)\]>"'`]+/g)) seen.add(m[0].replace(/[.,;:]+$/, ''));
  return [...seen];
}

/** Shape the engine output into the product files. */
export async function shape(input, engineDir, outDir, meta) {
  const files = await walk(engineDir);
  const texts = [];
  for (const f of files) {
    if (!TEXT.has(extname(f).toLowerCase())) continue;
    const s = await stat(f);
    if (s.size === 0) continue;
    const body = (await readFile(f, 'utf8')).trim();
    if (body) texts.push({ path: relative(engineDir, f), body });
  }
  if (!texts.length) throw new Error('the engine wrote no readable output');
  const main = texts.find((t) => /(^|\/)brief\.md$/i.test(t.path)) || texts.find((t) => /\.(md|markdown)$/i.test(t.path)) || texts[0];
  const rest = texts.filter((t) => t !== main);
  const title = input.title ? String(input.title).trim() : String(input.brief).trim();
  let brief = `# Research brief: ${title}\n\n${main.body}\n`;
  for (const t of rest) if (/\.(md|markdown|txt)$/i.test(t.path)) brief += `\n## From ${t.path}\n\n${t.body}\n`;
  const sources = extractSources(texts.map((t) => t.body).join('\n'));
  const sourcesMd = `# Sources\n\n${sources.length ? sources.map((u) => `- ${u}`).join('\n') : 'No source URL was found in the engine output.'}\n`;
  const run = { brief: input.brief, sovereign: !!input.sovereign, cost_usd: meta.cost_usd, engine_files: texts.map((t) => t.path), main: main.path, sources: sources.length };
  await mkdir(outDir, { recursive: true });
  const outs = { 'brief.md': brief, 'sources.md': sourcesMd, 'run.json': JSON.stringify(run, null, 2) + '\n' };
  const written = [];
  for (const [n, c] of Object.entries(outs)) { const p = join(outDir, n); await writeFile(p, c); written.push(p); }
  return written;
}

/** Run the engine through exec and shape its output into the product. */
export async function runTemplate(input, { outDir, exec = npxExec } = {}) {
  const { args } = planRun(input, outDir);
  const engineDir = args[args.indexOf('--out-dir') + 1];
  await mkdir(engineDir, { recursive: true });
  let r;
  try { r = await exec(args); } catch (e) { throw new Error(`the engine could not start: ${e && e.message ? e.message : e}`); }
  if (!r || r.code !== 0) {
    const tail = String((r && (r.stderr || r.stdout)) || '').replace(ANSI, '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
    throw new Error(`the engine failed with code ${r ? r.code : 'unknown'}${tail ? `: ${tail}` : ''}`);
  }
  const cost_usd = input.sovereign ? 0 : parseCost(r.stdout);
  const files = await shape(input, engineDir, outDir, { cost_usd });
  return { outDir, files, cost_usd };
}
