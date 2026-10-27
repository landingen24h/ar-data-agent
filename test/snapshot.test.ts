import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSnapshot, fetchAccounts, hashLines, snapshot, SPL_TOKEN, TOKEN_2022 } from '../src/index.ts';
import { run } from '../src/cli.ts';

const MINT = 'Mint1111111111111111111111111111111111111111';
function acc(pubkey: string, owner: string, amount: string, o: { mint?: string; program?: string; type?: string; state?: string; extensions?: unknown[] } = {}) {
  const program = o.program ?? TOKEN_2022;
  return {
    pubkey,
    account: {
      owner: program,
      data: {
        program: program === TOKEN_2022 ? 'spl-token-2022' : 'spl-token',
        parsed: {
          type: o.type ?? 'account',
          info: { mint: o.mint ?? MINT, owner, state: o.state ?? 'initialized', tokenAmount: { amount, decimals: 6 }, ...(o.extensions ? { extensions: o.extensions } : {}) },
        },
      },
    },
  };
}
const shuffle = <T>(a: T[], seed: number) => { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };

test('A1 accounts grouped by owner across both programs; other mints, zero balances and non accounts ignored', () => {
  const accounts = [
    acc('ta1', 'alice', '100', { program: SPL_TOKEN }),
    acc('ta2', 'alice', '50'),
    acc('ta3', 'bob', '120'),
    acc('ta4', 'carol', '999', { mint: 'OtherMint' }),
    acc('ta5', 'dave', '0'),
    acc('mintacct', 'erin', '500', { type: 'mint' }),
    { pubkey: 'raw', account: { owner: TOKEN_2022, data: ['AAAA', 'base64'] } },
    acc('ta6', 'frank', '7', { program: '11111111111111111111111111111111' }),
  ];
  const s = buildSnapshot({ mint: MINT, slot: 5, accounts: accounts as any });
  assert.deepEqual(s.holders, [{ rank: 1, owner: 'alice', amount: '150' }, { rank: 2, owner: 'bob', amount: '120' }]);
  assert.equal(s.total, '270');
  assert.equal(s.mint, MINT);
  assert.equal(s.slot, 5);
});

test('A1 BigInt math: amounts above 2^53 are summed exactly', () => {
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts: [acc('a', 'x', '9007199254740993'), acc('b', 'x', '9007199254740993')] as any });
  assert.equal(s.holders[0].amount, '18014398509481986');
});

test('A2 exclusions by owner and by token account', () => {
  const accounts = [acc('t1', 'curve', '1000'), acc('t2', 'alice', '300'), acc('t3', 'alice', '200'), acc('pool', 'bob', '900'), acc('t5', 'bob', '10')];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts: accounts as any, exclusions: { owners: ['curve'], token_accounts: ['pool'] } });
  assert.deepEqual(s.holders.map((h) => [h.owner, h.amount]), [['alice', '500'], ['bob', '10']]);
  assert.equal(s.total, '510');
});

test('A3 ranking by amount, ties by owner ascending, top keeps the first N', () => {
  const accounts = [acc('1', 'b', '5'), acc('2', 'a', '5'), acc('3', 'C', '5'), acc('4', 'z', '9'), acc('5', 'm', '1')];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts: accounts as any, top: 3 });
  assert.deepEqual(s.holders, [
    { rank: 1, owner: 'z', amount: '9' },
    { rank: 2, owner: 'C', amount: '5' },
    { rank: 3, owner: 'a', amount: '5' },
  ]);
  assert.equal(s.total, '25', 'total is over all counted owners, not only the kept ones');
  assert.equal(buildSnapshot({ mint: MINT, slot: 1, accounts: Array.from({ length: 150 }, (_, i) => acc(`t${i}`, `o${i}`, String(i + 1))) as any }).holders.length, 100);
  assert.throws(() => buildSnapshot({ mint: MINT, slot: 1, accounts: [], top: 0 }));
});

test('A4 hash rule and order independence', () => {
  const accounts = [acc('1', 'b', '5'), acc('2', 'a', '5'), acc('3', 'c', '7'), acc('4', 'a', '1')];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts: accounts as any });
  const text = hashLines(s.holders);
  assert.equal(text, '1,c,7\n2,a,6\n3,b,5');
  assert.equal(s.hash, createHash('sha256').update('1,c,7\n2,a,6\n3,b,5', 'utf8').digest('hex'));
  for (let seed = 1; seed < 6; seed++) assert.equal(buildSnapshot({ mint: MINT, slot: 1, accounts: shuffle(accounts, seed) as any }).hash, s.hash);
  assert.equal(buildSnapshot({ mint: MINT, slot: 1, accounts: [] }).hash, createHash('sha256').update('').digest('hex'));
});

test('A5 Token 2022 accounts with extensions and frozen state count by their amount', () => {
  const accounts = [
    acc('t1', 'alice', '40', { extensions: [{ extension: 'immutableOwner' }, { extension: 'transferFeeAmount', state: { withheldAmount: 3 } }] }),
    acc('t2', 'bob', '25', { state: 'frozen', extensions: [{ extension: 'immutableOwner' }] }),
  ];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts: accounts as any });
  assert.deepEqual(s.holders.map((h) => [h.owner, h.amount]), [['alice', '40'], ['bob', '25']]);
});

test('A6 fetchAccounts sends one jsonParsed getProgramAccounts call per token program', async () => {
  const calls: any[] = [];
  const fakeFetch = async (_url: string, init: any) => {
    const b = JSON.parse(init.body); calls.push(b);
    const program = b.params[0];
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: b.id, result: { context: { slot: program === SPL_TOKEN ? 120 : 118 }, value: [acc(program.slice(0, 4), 'o', '1', { program })] } }) };
  };
  const r = await fetchAccounts({ rpcUrl: 'https://rpc.example', mint: MINT, minContextSlot: 100, fetch: fakeFetch });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.params[0]).sort(), [SPL_TOKEN, TOKEN_2022].sort());
  for (const c of calls) {
    assert.equal(c.method, 'getProgramAccounts');
    assert.equal(c.params[1].encoding, 'jsonParsed');
    assert.equal(c.params[1].withContext, true);
    assert.equal(c.params[1].minContextSlot, 100);
    assert.deepEqual(c.params[1].filters, [{ memcmp: { offset: 0, bytes: MINT } }]);
  }
  assert.equal(r.slot, 118, 'slot is the lowest context slot');
  assert.equal(r.accounts.length, 2);
  await assert.rejects(fetchAccounts({ rpcUrl: 'https://rpc.example', mint: MINT, fetch: async () => ({ ok: true, status: 200, json: async () => ({ error: { code: -32010, message: 'excluded' } }) }) }), /RPC error -32010/);
});

test('A6 the CLI writes the snapshot from a recorded fixture with no network, and exits 1 on bad input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snap-'));
  const ex = join(dir, 'ex.json'); writeFileSync(ex, JSON.stringify({ owners: [], token_accounts: [] }));
  const fx = join(dir, 'fx.json'); writeFileSync(fx, JSON.stringify({ slot: 9, accounts: [acc('t1', 'a', '3'), acc('t2', 'b', '4')] }));
  const out: string[] = []; const err: string[] = [];
  const noNet = async () => { throw new Error('network used'); };
  const io = { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), env: { SOLANA_RPC_URL: 'https://secret.example/key123' }, fetch: noNet };
  assert.equal(await run(['--mint', MINT, '--exclusions', ex, '--fixture', fx, '--top', '1'], io), 0);
  const snap = JSON.parse(out.join(''));
  assert.deepEqual(snap.holders, [{ rank: 1, owner: 'b', amount: '4' }]);
  assert.equal(snap.slot, 9);
  const outFile = join(dir, 'o.json'); const saved = join(dir, 's.json');
  assert.equal(await run(['--mint', MINT, '--exclusions', ex, '--fixture', fx, '--out', outFile, '--save-fixture', saved], io), 0);
  assert.equal(JSON.parse(readFileSync(outFile, 'utf8')).total, '7');
  assert.equal(JSON.parse(readFileSync(saved, 'utf8')).slot, 9);
  for (const bad of [[], ['--exclusions', ex], ['--mint', MINT, '--exclusions', join(dir, 'missing.json')], ['--mint', MINT, '--exclusions', ex, '--fixture', fx, '--top', 'x'], ['--mint', MINT, '--exclusions', ex, '--bogus', '1']]) {
    err.length = 0;
    assert.equal(await run(bad, io), 1, JSON.stringify(bad));
    assert.match(err.join(''), /kog-snapshot: /);
  }
  err.length = 0;
  const failing = { ...io, fetch: async () => { throw new Error('connect failed to https://secret.example/key123'); } };
  assert.equal(await run(['--mint', MINT, '--exclusions', ex], failing), 1);
  assert.doesNotMatch(err.join(''), /key123/, 'the RPC URL is never printed');
});

test('A7 recorded fixture of a real Token 2022 mint (PYUSD on Solana mainnet)', () => {
  const fx = JSON.parse(readFileSync(new URL('../fixtures/pyusd-token2022.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(readFileSync(new URL('../fixtures/pyusd-token2022.expected.json', import.meta.url), 'utf8'));
  const ex = JSON.parse(readFileSync(new URL('../fixtures/pyusd-exclusions.json', import.meta.url), 'utf8'));
  const s = buildSnapshot({ mint: expected.mint, slot: fx.slot, accounts: fx.accounts, exclusions: ex });
  assert.equal(s.hash, expected.hash_parts.join(''));
  assert.equal(s.total, expected.total);
  assert.equal(s.holders.length, 100);
  assert.ok(fx.accounts.every((a: any) => a.account.owner === TOKEN_2022));
  assert.ok(fx.accounts.some((a: any) => (a.account.data.parsed.info.extensions ?? []).some((e: any) => e.extension === 'transferFeeAmount')));
  assert.ok(!s.holders.some((h) => ex.owners.includes(h.owner)));
  assert.equal(buildSnapshot({ mint: expected.mint, slot: fx.slot, accounts: shuffle(fx.accounts, 42), exclusions: ex }).hash, expected.hash_parts.join(''));
});

test('A4 snapshot({accounts, exclusions, top}) infers the mint and gives the same hash as buildSnapshot', () => {
  const fx = JSON.parse(readFileSync(new URL('../fixtures/pyusd-token2022.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(readFileSync(new URL('../fixtures/pyusd-token2022.expected.json', import.meta.url), 'utf8'));
  const ex = JSON.parse(readFileSync(new URL('../fixtures/pyusd-exclusions.json', import.meta.url), 'utf8'));
  const s = snapshot({ accounts: fx.accounts, exclusions: ex, top: 100 });
  assert.equal(s.hash, expected.hash_parts.join(''));
  assert.deepEqual(s.holders, expected.holders);
  assert.throws(() => snapshot({ accounts: [acc('a', 'x', '1'), acc('b', 'y', '1', { mint: 'Other' })] as any }), /more than one mint/);
});
