import { readFile, writeFile } from 'node:fs/promises';
import { buildSnapshot, fetchAccounts, type Exclusions } from './index.ts';

export interface Io { stdout: (s: string) => void; stderr: (s: string) => void; env: Record<string, string | undefined>; fetch?: any }

const USAGE = 'usage: kog-snapshot --mint <address> --exclusions <file> [--slot <n>] [--top <n>] [--out <file>] [--fixture <file>] [--save-fixture <file>]';

export function parseArgs(argv: string[]): Record<string, string> {
  const known = new Set(['mint', 'exclusions', 'slot', 'top', 'out', 'fixture', 'save-fixture']);
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || !known.has(a.slice(2))) throw new Error(`unknown argument ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

function posInt(name: string, v: string | undefined, min: number): number | undefined {
  if (v === undefined) return undefined;
  if (!/^[0-9]+$/.test(v) || Number(v) < min) throw new Error(`--${name} must be an integer of at least ${min}`);
  return Number(v);
}

async function readJson(path: string, what: string): Promise<any> {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { throw new Error(`cannot read ${what} file ${path}`); }
  try { return JSON.parse(text); } catch { throw new Error(`${what} file ${path} is not valid JSON`); }
}

/** Returns the exit code. Never prints the RPC URL. */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const a = parseArgs(argv);
    if (!a.mint) throw new Error('--mint is required');
    if (!a.exclusions) throw new Error('--exclusions is required');
    const slotArg = posInt('slot', a.slot, 0);
    const top = posInt('top', a.top, 1);
    const ex = (await readJson(a.exclusions, 'exclusions')) as Exclusions;
    if (!ex || typeof ex !== 'object' || (ex.owners && !Array.isArray(ex.owners)) || (ex.token_accounts && !Array.isArray(ex.token_accounts)))
      throw new Error('exclusions must be {owners: string[], token_accounts: string[]}');
    let data: { slot: number; accounts: any[] };
    if (a.fixture) {
      data = await readJson(a.fixture, 'fixture');
      if (!data || !Number.isInteger(data.slot) || !Array.isArray(data.accounts)) throw new Error('fixture must be {slot, accounts}');
    } else {
      const rpcUrl = io.env.SOLANA_RPC_URL;
      if (!rpcUrl) throw new Error('SOLANA_RPC_URL is not set (or pass --fixture)');
      data = await fetchAccounts({ rpcUrl, mint: a.mint, minContextSlot: slotArg, fetch: io.fetch });
    }
    if (a['save-fixture']) await writeFile(a['save-fixture'], JSON.stringify(data) + '\n');
    const snap = buildSnapshot({ mint: a.mint, slot: data.slot, accounts: data.accounts, exclusions: ex, top });
    const json = JSON.stringify(snap, null, 2) + '\n';
    if (a.out) await writeFile(a.out, json); else io.stdout(json);
    return 0;
  } catch (e) {
    const rpc = io.env.SOLANA_RPC_URL;
    let msg = (e as Error).message;
    if (rpc) msg = msg.split(rpc).join('<rpc>');
    io.stderr(`kog-snapshot: ${msg}\n${USAGE}\n`);
    return 1;
  }
}
