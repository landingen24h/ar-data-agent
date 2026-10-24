import test from 'node:test';
import assert from 'node:assert/strict';
import { read, contrast } from './lib.mjs';
const REQUIRED = ['bg', 'surface', 'text', 'text-muted', 'primary', 'on-primary', 'border', 'danger'];
const PAIRS = [['text', 'bg'], ['text', 'surface'], ['text-muted', 'bg'], ['text-muted', 'surface'], ['on-primary', 'primary'], ['danger', 'bg']];
test('A1 tokens.json has both themes with every required colour as #rrggbb, plus type, space and radius', () => {
  const t = JSON.parse(read('tokens/tokens.json'));
  for (const k of ['type', 'space', 'radius']) assert.ok(t[k] && Object.keys(t[k]).length, k);
  for (const theme of ['light', 'dark']) for (const k of REQUIRED) assert.match(t.color[theme][k], /^#[0-9a-f]{6}$/i, `${theme}.${k}`);
});
test('A1 every text pair reaches 4.5 to 1 in light and in dark', () => {
  const t = JSON.parse(read('tokens/tokens.json'));
  for (const theme of ['light', 'dark']) for (const [fg, bg] of PAIRS) {
    const r = contrast(t.color[theme][fg], t.color[theme][bg]);
    assert.ok(r >= 4.5, `${theme} ${fg} on ${bg} is ${r.toFixed(2)}`);
  }
});
test('A1 tokens.css holds the same values: light by default, dark under prefers-color-scheme and [data-theme="dark"]', () => {
  const t = JSON.parse(read('tokens/tokens.json'));
  const css = read('tokens/tokens.css');
  const root = css.slice(0, css.indexOf('@media'));
  const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('[data-theme="dark"]'));
  const attr = css.slice(css.indexOf('[data-theme="dark"]'));
  assert.ok(media.length && attr.length);
  for (const [k, v] of Object.entries(t.color.light)) assert.ok(root.includes(`--color-${k}: ${v};`), `light ${k}`);
  for (const [k, v] of Object.entries(t.color.dark)) {
    assert.ok(media.includes(`--color-${k}: ${v};`), `media dark ${k}`);
    assert.ok(attr.includes(`--color-${k}: ${v};`), `attr dark ${k}`);
  }
});
