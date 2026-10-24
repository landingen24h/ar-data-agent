import test from 'node:test';
import assert from 'node:assert/strict';
import { read, exists, SCREENS } from './lib.mjs';
test('A2 every screen exists in English and in Arabic', () => {
  for (const s of SCREENS) {
    assert.ok(exists(`prototype/${s}.html`), `en ${s}`);
    assert.ok(exists(`prototype/ar/${s}.html`), `ar ${s}`);
  }
});
test('A2 Arabic screens are lang ar and flow right to left, with Arabic text', () => {
  for (const s of SCREENS) {
    const h = read(`prototype/ar/${s}.html`);
    assert.match(h, /<html lang="ar" dir="rtl">/, s);
    assert.match(h, /[\u0600-\u06FF]/, `${s} has Arabic text`);
  }
});
test('A2 English screens are lang en and left to right', () => {
  for (const s of SCREENS) assert.match(read(`prototype/${s}.html`), /<html lang="en" dir="ltr">/, s);
});
test('A2 the layout uses logical properties so it mirrors in right to left', () => {
  const css = read('prototype/app.css');
  assert.doesNotMatch(css, /(margin|padding)-(left|right)|text-align:\s*(left|right)|float:/);
});
