import { createHash } from 'node:crypto';

export const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const TOKEN_PROGRAMS = [SPL_TOKEN, TOKEN_2022] as const;

export interface ParsedTokenAccount {
  pubkey: string;
  account: {
    owner?: string;
    data: {
      program?: string;
      parsed?: {
        type?: string;
        info?: {
          mint?: string;
          owner?: string;
          state?: string;
          tokenAmount?: { amount?: string; decimals?: number };
          extensions?: unknown[];
        };
      };
    } | unknown;
  };
}
export interface Exclusions { owners?: string[]; token_accounts?: string[] }
export interface Holder { rank: number; owner: string; amount: string }
export interface Snapshot { mint: string; slot: number; total: string; holders: Holder[]; hash: string }

const DIGITS = /^[0-9]+$/;

/** The lines that are hashed: rank,owner,amount joined by a newline, no trailing newline. */
export function hashLines(holders: Holder[]): string {
  return holders.map((h) => `${h.rank},${h.owner},${h.amount}`).join('\n');
}
export function hashHolders(holders: Holder[]): string {
  return createHash('sha256').update(hashLines(holders), 'utf8').digest('hex');
}

/** Pure: same input in any order gives the same output. BigInt math only. */
export function buildSnapshot(input: {
  mint: string;
  slot: number;
  accounts: ParsedTokenAccount[];
  exclusions?: Exclusions;
  top?: number;
}): Snapshot {
  const { mint, slot, accounts } = input;
  if (typeof mint !== 'string' || mint.length === 0) throw new Error('mint is required');
  if (!Number.isInteger(slot) || slot < 0) throw new Error('slot must be a non negative integer');
  if (!Array.isArray(accounts)) throw new Error('accounts must be an array');
  const top = input.top ?? 100;
  if (!Number.isInteger(top) || top < 1) throw new Error('top must be a positive integer');
  const exOwners = new Set(input.exclusions?.owners ?? []);
  const exAccounts = new Set(input.exclusions?.token_accounts ?? []);
  const perOwner = new Map<string, bigint>();
  const seenAccounts = new Set<string>();
  for (const item of accounts) {
    const data = (item?.account as { data?: unknown } | undefined)?.data as
      | { program?: string; parsed?: { type?: string; info?: Record<string, any> } }
      | undefined;
    const parsed = data && typeof data === 'object' ? data.parsed : undefined;
    if (!parsed || parsed.type !== 'account' || !parsed.info) continue;
    const programOwner = item.account.owner;
    if (programOwner !== undefined && !(TOKEN_PROGRAMS as readonly string[]).includes(programOwner)) continue;
    const info = parsed.info;
    if (info.mint !== mint) continue;
    const owner = info.owner;
    const amount = info.tokenAmount?.amount;
    if (typeof owner !== 'string' || typeof amount !== 'string' || !DIGITS.test(amount)) continue;
    const value = BigInt(amount);
    if (value <= 0n) continue;
    if (typeof item.pubkey !== 'string' || seenAccounts.has(item.pubkey)) continue; // a token account counts once
    seenAccounts.add(item.pubkey);
    if (exAccounts.has(item.pubkey) || exOwners.has(owner)) continue;
    perOwner.set(owner, (perOwner.get(owner) ?? 0n) + value);
  }
  let total = 0n;
  for (const v of perOwner.values()) total += v;
  const ranked = [...perOwner.entries()].sort((a, b) =>
    a[1] === b[1] ? (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) : a[1] > b[1] ? -1 : 1,
  );
  const holders = ranked.slice(0, top).map(([owner, v], i) => ({ rank: i + 1, owner, amount: v.toString() }));
  return { mint, slot, total: total.toString(), holders, hash: hashHolders(holders) };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

/** One getProgramAccounts call per token program, jsonParsed, withContext, memcmp on the mint at offset 0. */
export async function fetchAccounts(opts: {
  rpcUrl: string;
  mint: string;
  minContextSlot?: number;
  fetch?: FetchLike;
}): Promise<{ slot: number; accounts: ParsedTokenAccount[] }> {
  const f: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (!opts.rpcUrl) throw new Error('rpcUrl is required');
  if (!opts.mint) throw new Error('mint is required');
  const answers = await Promise.all(
    TOKEN_PROGRAMS.map(async (program, i) => {
      const config: Record<string, unknown> = {
        encoding: 'jsonParsed',
        withContext: true,
        commitment: 'confirmed',
        filters: [{ memcmp: { offset: 0, bytes: opts.mint } }],
      };
      if (opts.minContextSlot !== undefined) config.minContextSlot = opts.minContextSlot;
      const body = JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'getProgramAccounts', params: [program, config] });
      let res;
      try {
        res = await f(opts.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      } catch (e) {
        throw new Error(`RPC request failed: ${(e as Error).message}`.replace(opts.rpcUrl, '<rpc>'));
      }
      if (!res.ok) throw new Error(`RPC answered HTTP ${res.status}`);
      const j = await res.json();
      if (j?.error) throw new Error(`RPC error ${j.error.code}: ${j.error.message}`);
      const slot = j?.result?.context?.slot;
      const value = j?.result?.value;
      if (!Number.isInteger(slot) || !Array.isArray(value)) throw new Error('RPC answer is not a getProgramAccounts result with context');
      return { slot: slot as number, value: value as ParsedTokenAccount[] };
    }),
  );
  return { slot: Math.min(...answers.map((a) => a.slot)), accounts: answers.flatMap((a) => a.value) };
}

/**
 * The shape of the "KOG top holder snapshot" seat: snapshot({accounts, exclusions, top}) -> {holders, hash}.
 * Without mint, the accounts must all be of one mint (other items are ignored as in buildSnapshot); mixed mints throw.
 */
export function snapshot(input: { accounts: ParsedTokenAccount[]; exclusions?: Exclusions; top?: number; mint?: string; slot?: number }): Snapshot {
  let mint = input.mint;
  if (!mint) {
    const mints = new Set<string>();
    for (const a of input.accounts ?? []) {
      const p = (a?.account as any)?.data?.parsed;
      if (p?.type === 'account' && typeof p.info?.mint === 'string') mints.add(p.info.mint);
    }
    if (mints.size !== 1) throw new Error(mints.size === 0 ? 'no token accounts' : 'accounts of more than one mint: pass mint');
    mint = [...mints][0];
  }
  return buildSnapshot({ mint, slot: input.slot ?? 0, accounts: input.accounts, exclusions: input.exclusions, top: input.top });
}
