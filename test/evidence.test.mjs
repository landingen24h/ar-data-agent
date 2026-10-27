// Integrity checks for the recorded runs. Pure Node, no network, no child processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = new URL('../v0.4.1/', import.meta.url);
const RUNS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
const read = (q, f) => fs.readFileSync(new URL(`${q}/${f}`, ROOT), 'utf8');
const filesIn = (diff) => [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);

for (const q of RUNS) {
  test(`${q} transcript is a 200 answer whose patch is byte identical to patch.diff`, () => {
    const t = JSON.parse(read(q, 'transcript.json'));
    assert.equal(t.status, 200);
    assert.equal(typeof t.response.patch, 'string');
    assert.equal(t.response.patch, read(q, 'patch.diff'));
  });

  test(`${q} patch is a well formed unified diff with every file under qualifier/${q}/`, () => {
    const diff = read(q, 'patch.diff');
    const files = filesIn(diff);
    assert.ok(files.length > 0, 'no files in diff');
    for (const f of files) {
      assert.ok(f.startsWith(`qualifier/${q}/`), `${f} is outside qualifier/${q}/`);
      assert.ok(!f.includes('..'), `${f} has ..`);
    }
    for (const h of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) assert.ok(Number(h[3]) >= 0);
  });

  test(`${q} answer lists at least one test file and that file is in the patch`, () => {
    const t = JSON.parse(read(q, 'transcript.json'));
    const files = filesIn(read(q, 'patch.diff'));
    assert.ok(Array.isArray(t.response.tests) && t.response.tests.length > 0);
    for (const p of t.response.tests) assert.ok(files.includes(p), `${p} not in patch`);
  });
}

test('no long hex strings or key blocks in the evidence (secret scanner hygiene)', () => {
  for (const q of RUNS) for (const f of ['transcript.json', 'patch.diff']) {
    const s = read(q, f);
    assert.doesNotMatch(s, /[0-9a-fA-F]{64}/, `${q}/${f}`);
    assert.doesNotMatch(s, /BEGIN [A-Z ]*PRIVATE KEY/, `${q}/${f}`);
  }
});
