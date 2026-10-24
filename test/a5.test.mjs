import test from 'node:test';
import assert from 'node:assert/strict';
import { read, allPages, visibleText } from './lib.mjs';
test('A5 every page sets its language', () => {
  for (const p of allPages()) assert.match(read(p), /<html lang="(en|ar)" dir="(ltr|rtl)">/, p);
});
test('A5 images have alt text', () => {
  for (const p of allPages()) {
    const h = read(p);
    for (const m of h.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /alt="[^"]+"/, `${p} ${m[0]}`);
    for (const m of h.matchAll(/<svg\b[^>]*>/g)) assert.match(m[0], /role="img"[^>]*aria-label="[^"]+"|aria-hidden="true"/, `${p} ${m[0]}`);
  }
});
test('A5 controls have labels', () => {
  for (const p of allPages()) {
    const h = read(p);
    for (const m of h.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const id = (m[0].match(/id="([^"]+)"/) || [])[1];
      const ok = /aria-label="[^"]+"/.test(m[0]) || (id && h.includes(`<label for="${id}"`));
      assert.ok(ok, `${p} ${m[0]}`);
    }
    for (const m of h.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) assert.ok(m[1].trim() || /aria-label=/.test(m[0]), `${p} button`);
    for (const m of h.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.ok(m[1].replace(/<[^>]+>/g, '').trim(), `${p} empty link`);
  }
});
test('A5 house rules: Latin digits only and no long dashes in text people see', () => {
  for (const p of [...allPages(), 'README.md']) {
    const t = p.endsWith('.md') ? read(p) : visibleText(read(p)) + [...read(p).matchAll(/(placeholder|aria-label|alt|title)="([^"]*)"/g)].map((m) => m[2]).join(' ');
    assert.doesNotMatch(t, /[\u0660-\u0669\u06F0-\u06F9]/, `${p} non Latin digits`);
    assert.doesNotMatch(t, /[\u2012\u2013\u2014\u2015\u2212]/, `${p} long dash`);
  }
});
