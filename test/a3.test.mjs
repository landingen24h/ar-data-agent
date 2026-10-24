import test from 'node:test';
import assert from 'node:assert/strict';
import { read, allPages } from './lib.mjs';
test('A3 every page has a viewport meta and loads tokens.css and app.css', () => {
  for (const p of allPages()) {
    const h = read(p);
    assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1">/, p);
    assert.match(h, /href="(\.\.\/)+tokens\/tokens\.css"/, p);
    assert.match(h, /href="(\.\.\/)?app\.css"/, p);
  }
});
test('A3 the stylesheet takes every colour from the tokens', () => {
  const css = read('prototype/app.css');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  for (const m of css.matchAll(/(color|background|border[a-z-]*|outline)\s*:\s*([^;}]+)/g)) {
    if (/var\(--color-|transparent|inherit|none|^0$|^\d+px solid$|^\d+px$/.test(m[2].trim()) || /1px solid var/.test(m[2])) continue;
    if (/radius/.test(m[1])) continue;
    assert.fail(`raw value ${m[0]}`);
  }
});
test('A3 nothing forces a width above a 360 px phone', () => {
  const css = read('prototype/app.css');
  for (const m of css.matchAll(/(^|[;{])\s*(min-width|width)\s*:\s*(\d+)px/g)) assert.ok(+m[3] <= 360, m[0]);
  for (const p of allPages()) for (const m of read(p).matchAll(/style="[^"]*(?<!max-)width:\s*(\d+)px/g)) assert.ok(+m[1] <= 360, `${p} ${m[0]}`);
});
