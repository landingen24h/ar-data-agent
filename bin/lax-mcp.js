#!/usr/bin/env node
import { main } from '../dist/cli.js';
main().catch((e) => { process.stderr.write(`[lax-mcp] ${e && e.message ? e.message : e}\n`); process.exit(1); });
