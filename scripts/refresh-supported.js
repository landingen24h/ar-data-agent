// Refresh the bundled /supported snapshot used by the Workers build.
import { writeFileSync } from 'node:fs';
const r = await fetch((process.env.FACILITATOR_URL || 'https://api.x402.celo.org') + '/supported');
if (!r.ok) throw new Error(`supported ${r.status}`);
writeFileSync(new URL('../src/supported.celo.json', import.meta.url), JSON.stringify(await r.json()) + '\n');
console.log('updated src/supported.celo.json');
