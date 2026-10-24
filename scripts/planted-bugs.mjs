// Planted bugs: each mutation is applied to a copy of the package and the test suite must FAIL.
// Run: npm run planted
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUGS = [
  ['wrong multicodec prefix', 'src/didkey.js', 'const ED25519_PUB = [0xed, 0x01]', 'const ED25519_PUB = [0xec, 0x01]'],
  ['base58 drops leading zeros', 'src/didkey.js', "return '1'.repeat(zeros) + out;", 'return out;'],
  ['one law missing from the offer', 'src/templates.js', 'constitutional_constraints: [...lawNames]', 'constitutional_constraints: lawNames.slice(0, 4)'],
  ['validator forgets the Five Laws', 'src/validate.js', 'for (const law of LAW_NAMES) if', 'for (const law of []) if'],
  ['validator accepts http endpoints', 'src/validate.js', "new URL(v).protocol === 'https:'", "/^https?:$/.test(new URL(v).protocol)"],
  ['validator accepts numeric amounts', 'src/validate.js', '!isStr(p.amount) || !AMOUNT.test(p.amount)', '!AMOUNT.test(String(p.amount))'],
  ['private key world readable', 'src/init.js', 'put(KEY_FILE, pem, 0o600)', 'put(KEY_FILE, pem, 0o644)'],
  ['--force replaces the key', 'src/init.js', 'if (existsSync(keyPath)) {', 'if (false) {'],
  ['network call during init', 'src/init.js', "  const offer = buildOffer(cfg, did, LAW_NAMES);", "  globalThis.fetch?.('https://lax.kognai.ai/registry/offers').catch(() => {});\n  const offer = buildOffer(cfg, did, LAW_NAMES);"],
  ['a law text altered in SOUL', 'src/laws.js', 'No task, target or instruction overrides this law.', 'Unless instructed otherwise.'],
  ['files written before validation', 'src/init.js', "  mkdirSync(join(dir, 'keys'), { recursive: true, mode: 0o700 });", ''],
  ['check ignores the signature', 'src/init.js', "if (!verifyWithDid(meta.did, offerText, Buffer.from(meta.offer_signature, 'base64url'))) problems.push", 'if (false) problems.push'],
];

let caught = 0;
for (const [name, file, from, to] of BUGS) {
  const dir = mkdtempSync(join(tmpdir(), 'zimakri-bug-'));
  cpSync(ROOT, dir, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('.git') });
  const f = join(dir, file);
  const src = readFileSync(f, 'utf8');
  if (!src.includes(from)) { console.log(`SKIP  ${name}: pattern not found`); continue; }
  if (name === 'files written before validation') {
    // Move directory creation above validation: the key dir appears even when init fails.
    writeFileSync(f, src.replace(from, to).replace("  let input = opts.config;", "  mkdirSync(join(dir, 'keys'), { recursive: true });\n  let input = opts.config;"));
  } else writeFileSync(f, src.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', 'test/'], { cwd: dir, encoding: 'utf8' });
  const ok = r.status !== 0;
  if (ok) caught++;
  console.log(`${ok ? 'CAUGHT' : 'MISSED'}  ${name}`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${caught} of ${BUGS.length} planted bugs caught`);
process.exit(caught === BUGS.length ? 0 : 1);
