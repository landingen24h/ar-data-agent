import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { read, exists, allPages, SCREENS, hrefs } from './lib.mjs';
const local = (h) => !/^(https?:|mailto:|#)/.test(h);
test('A4 no local link is broken', () => {
  for (const p of allPages()) for (const h of hrefs(read(p)).filter(local)) {
    const target = posix.normalize(posix.join(posix.dirname(p), h.split('#')[0]));
    assert.ok(exists(target), `${p} -> ${h}`);
  }
});
test('A4 every screen and the design system are reachable from index.html', () => {
  const seen = new Set(['prototype/index.html']);
  const queue = ['prototype/index.html'];
  while (queue.length) {
    const p = queue.shift();
    for (const h of hrefs(read(p)).filter((x) => local(x) && x.endsWith('.html'))) {
      const t = posix.normalize(posix.join(posix.dirname(p), h));
      if (!seen.has(t) && exists(t)) { seen.add(t); queue.push(t); }
    }
  }
  for (const p of allPages()) assert.ok(seen.has(p), p);
});
test('A4 every screen links to the screens it leads to', () => {
  const leads = { 'first-run': ['lobby'], lobby: ['chat', 'services', 'wallet'], chat: ['lobby'], services: ['chat', 'wallet'], wallet: ['lobby'], settings: ['first-run'] };
  for (const dir of ['', 'ar/']) for (const s of SCREENS) {
    const hs = hrefs(read(`prototype/${dir}${s}.html`));
    for (const t of leads[s]) assert.ok(hs.includes(`${t}.html`), `${dir}${s} -> ${t}`);
  }
});
