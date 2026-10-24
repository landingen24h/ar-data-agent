// Optional, run by hand AFTER init: asks the LAX registry to validate lax-offer.json
// without listing it. POST /registry/offers without a payment header: the registry
// answers 400 with the reason if the offer is invalid, or 402 ("Your offer is valid;
// pay 0.01 USDC") if it is valid. Nothing is paid, nothing is listed, no key is sent.
// This is the only file in the package that uses the network, and init never calls it.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'lax-offer.json';
const url = process.env.LAX_REGISTRY ?? 'https://lax.kognai.ai/registry/offers';
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: readFileSync(file, 'utf8') });
let note = '';
const pr = res.headers.get('payment-required');
if (pr) { try { note = JSON.parse(Buffer.from(pr, 'base64').toString('utf8')).error ?? ''; } catch {} }
const body = await res.text();
if (res.status === 402) { console.log(`registry: valid (HTTP 402, not listed, nothing paid)${note ? '\n' + note : ''}`); }
else { console.error(`registry: HTTP ${res.status} ${body}`); process.exit(1); }
