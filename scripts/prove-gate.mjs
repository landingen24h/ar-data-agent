// Runs the suite against a registry with the fee gate removed. The suite must fail there,
// which shows the tests depend on the gate and do not pass by accident.
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'test/fee-gate.test.ts'], { env: { ...process.env, UNGATED: '1' }, encoding: 'utf8' });
const fail = /# fail (\d+)/.exec(r.stdout)?.[1];
if (r.status === 0 || !fail || Number(fail) === 0) { console.error('the suite passed without the fee gate'); process.exit(1); }
console.log(`ok: without the fee gate ${fail} tests fail, as they should`);
