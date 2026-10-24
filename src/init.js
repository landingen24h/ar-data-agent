// zimakri init: creates a sovereign Zimakri agent in a folder. Local only: no network,
// no Kognai account, and the private key never leaves the folder.
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { generateIdentity, didFromPublicKey, signWith, verifyWithDid } from './didkey.js';
import { LAW_NAMES, LAWS_SOURCE } from './laws.js';
import { normalizeConfig, CONFIG_FILE } from './config.js';
import { soulMd, wakeMd, memoryReadme, memoryIndex, buildOffer, MEMORY_DIRS } from './templates.js';
import { validateOffer } from './validate.js';

export const KEY_FILE = join('keys', 'agent.key');

function didOfPem(pem) {
  const x = createPublicKey(createPrivateKey(pem)).export({ format: 'jwk' }).x;
  return didFromPublicKey(Buffer.from(x, 'base64url'));
}

/**
 * @param {import('../types/index.js').InitOptions} [opts]
 * @returns {import('../types/index.js').InitResult}
 */
export function init(opts = {}) {
  const dir = resolve(opts.dir ?? '.');
  const now = (opts.now ?? new Date()).toISOString();
  let input = opts.config;
  const cfgPath = join(dir, CONFIG_FILE);
  if (!input && existsSync(cfgPath)) input = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const cfg = normalizeConfig(input ?? {});

  if (existsSync(join(dir, 'zimakri.json')) && !opts.force) {
    throw new Error('this folder is already a Zimakri agent (zimakri.json exists); use --force to rewrite the files, the key is kept');
  }

  // Keep an existing key: an identity is never replaced silently.
  const keyPath = join(dir, KEY_FILE);
  let did, pem, newKey = false;
  if (existsSync(keyPath)) { pem = readFileSync(keyPath, 'utf8'); did = didOfPem(pem); }
  else { const id = generateIdentity(); did = id.did; pem = id.privateKeyPem; newKey = true; }

  const offer = buildOffer(cfg, did, LAW_NAMES);
  const v = validateOffer(offer);
  if (!v.ok) throw new Error('the LAX offer from your config is not valid: ' + v.errors.join('; '));

  // Proof that the key works: the agent signs its own offer.
  const offerText = JSON.stringify(offer, null, 2) + '\n';
  const signature = signWith(pem, offerText).toString('base64url');
  if (!verifyWithDid(did, offerText, Buffer.from(signature, 'base64url'))) throw new Error('self signature check failed');

  const files = [];
  const put = (rel, text, mode) => {
    const p = join(dir, rel);
    writeFileSync(p, text, mode ? { mode } : undefined);
    if (mode) chmodSync(p, mode);
    files.push(rel);
  };
  mkdirSync(join(dir, 'keys'), { recursive: true, mode: 0o700 });
  for (const d of MEMORY_DIRS) mkdirSync(join(dir, 'memory', d), { recursive: true });

  if (newKey) put(KEY_FILE, pem, 0o600);
  put(join('keys', '.gitignore'), '*\n');
  if (!existsSync(cfgPath)) put(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  put('zimakri.json', JSON.stringify({ zimakri: 1, did, created_at: now, key_file: 'keys/agent.key', laws_source: LAWS_SOURCE, offer_file: 'lax-offer.json', offer_signature: signature }, null, 2) + '\n');
  put('SOUL.md', soulMd(cfg, did, now));
  put('WAKE.md', wakeMd(cfg));
  put(join('memory', 'README.md'), memoryReadme());
  put(join('memory', 'index.json'), JSON.stringify(memoryIndex(now), null, 2) + '\n');
  put(join('memory', 'working', 'now.md'), '# Now\n\nNothing in progress yet.\n');
  put(join('memory', 'journal', now.slice(0, 10) + '.md'), `# ${now.slice(0, 10)}\n\n* ${now} Born as ${did}. Created SOUL.md, WAKE.md, memory/ and lax-offer.json locally. No network, no spending.\n`);
  put('lax-offer.json', offerText);
  return { dir, did, files, offer, newKey };
}

/**
 * Checks an agent folder: key matches DID, offer valid, signature valid. No network.
 * @param {string} [dirArg]
 */
export function check(dirArg = '.') {
  const dir = resolve(dirArg);
  const meta = JSON.parse(readFileSync(join(dir, 'zimakri.json'), 'utf8'));
  const pem = readFileSync(join(dir, KEY_FILE), 'utf8');
  const problems = [];
  if (didOfPem(pem) !== meta.did) problems.push('the key in keys/agent.key does not match the DID in zimakri.json');
  const offerText = readFileSync(join(dir, 'lax-offer.json'), 'utf8');
  const offer = JSON.parse(offerText);
  const v = validateOffer(offer);
  problems.push(...v.errors);
  if (offer.agent_did !== meta.did) problems.push('lax-offer.json agent_did does not match zimakri.json');
  if (!verifyWithDid(meta.did, offerText, Buffer.from(meta.offer_signature, 'base64url'))) problems.push('the offer signature does not verify (lax-offer.json changed after init?)');
  return { ok: problems.length === 0, did: meta.did, problems };
}
