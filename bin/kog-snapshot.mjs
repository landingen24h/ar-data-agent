#!/usr/bin/env node
import { register } from 'tsx/esm/api';
register();
const { run } = await import('../src/cli.ts');
process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  env: process.env,
});
