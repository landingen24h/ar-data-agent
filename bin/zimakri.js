#!/usr/bin/env node
// CLI: npx zimakri init [dir] [--name N] [--description D] [--endpoint URL] [--force]
//      npx zimakri check [dir]
//      npx zimakri validate [file]
import { readFileSync } from 'node:fs';
import { init, check } from '../src/init.js';
import { validateOffer } from '../src/validate.js';

const HELP = `zimakri: become a sovereign Zimakri agent, locally.

  zimakri init [dir] [--name N] [--description D] [--endpoint URL] [--category C] [--force]
  zimakri check [dir]          key matches DID, offer valid, offer signature valid
  zimakri validate [file]      validate a LAX offer file (default lax-offer.json)

No network, no account, no key sent anywhere. Edit zimakri.config.json for the full typed config.`;

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force' || a === '-f') flags.force = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`missing value for --${k}`);
      flags[k] = v;
    } else pos.push(a);
  }
  return { pos, flags };
}

try {
  const { pos, flags } = parse(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || flags.help) { console.log(HELP); process.exit(cmd || flags.help ? 0 : 1); }
  if (cmd === 'init') {
    const config = {};
    for (const k of ['name', 'description', 'endpoint', 'category']) if (flags[k] !== undefined) config[k] = flags[k];
    const r = init({ dir: pos[1] ?? '.', config: Object.keys(config).length ? config : undefined, force: !!flags.force });
    console.log(`Zimakri agent ready in ${r.dir}\nDID: ${r.did}\n${r.newKey ? 'New key written to keys/agent.key (mode 600, never leaves this folder).' : 'Existing key kept.'}\nFiles: ${r.files.filter((f) => !f.startsWith('keys')).join(', ')}\nThe LAX offer in lax-offer.json passes local validation. Nothing was sent anywhere.`);
  } else if (cmd === 'check') {
    const r = check(pos[1] ?? '.');
    if (r.ok) console.log(`ok ${r.did}`); else { console.error(r.problems.join('\n')); process.exit(1); }
  } else if (cmd === 'validate') {
    const r = validateOffer(JSON.parse(readFileSync(pos[1] ?? 'lax-offer.json', 'utf8')));
    if (r.ok) console.log('valid'); else { console.error(r.errors.join('\n')); process.exit(1); }
  } else { console.error(`unknown command ${cmd}\n\n${HELP}`); process.exit(1); }
} catch (err) {
  console.error('zimakri: ' + err.message);
  process.exit(1);
}
