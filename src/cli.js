#!/usr/bin/env node
import { runTemplate } from './index.js';
const a = process.argv.slice(2);
const sovereign = a.includes('--sovereign');
const i = a.indexOf('--out-dir');
const outDir = i >= 0 ? a[i + 1] : './brief-out';
const brief = a.filter((x, k) => !x.startsWith('--') && (i < 0 || k !== i + 1)).join(' ');
if (!brief) { console.error('usage: kognai-research-brief "<what you want researched>" [--out-dir dir] [--sovereign]'); process.exit(2); }
runTemplate({ brief, sovereign }, { outDir }).then((r) => { console.log(JSON.stringify(r, null, 2)); }, (e) => { console.error(e.message); process.exit(1); });
