import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCREENS = ['first-run', 'lobby', 'chat', 'services', 'wallet', 'settings'];
export const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const exists = (p) => existsSync(join(ROOT, p));
export const allPages = () => [
  'prototype/index.html', 'prototype/design-system.html',
  ...SCREENS.map((s) => `prototype/${s}.html`),
  ...SCREENS.map((s) => `prototype/ar/${s}.html`),
];
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
export const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
export const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
