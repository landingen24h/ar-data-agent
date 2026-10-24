import type { DebateDeps, DebateInput, RouteArgs, RouteResult } from '../src/debate.ts';

export const input: DebateInput = {
  facts_text: [
    'Top 10 holders own 62.4 percent of supply.',
    'Mint authority: revoked.',
    'Freeze authority: active.',
    'Liquidity locked: 0 percent.',
    'Pool depth: 18,500 USD.',
    'Token age: 3 days.',
  ].join('\n'),
  level: 'high', points: 71, flag_ids: ['concentration', 'freeze_authority', 'unlocked_liquidity'], unknown: ['team wallets'],
};

export const SOUND = 'Mint authority is revoked, so no new supply can be created after launch. Pool depth of 18,500 USD gives some room for ordinary transfers.';
export const FRAGILE = 'The top 10 holders own 62.4 percent of supply and liquidity locked is 0 percent. Freeze authority is still active, and the token is 3 days old.';
export const REVIEW = JSON.stringify({
  text: 'The fragile case weighs more: concentration at 62.4 percent with 0 percent locked liquidity and an active freeze authority outweigh the revoked mint.',
  weight: ['concentration', 'unlocked_liquidity', 'made_up_rule'], unknown: ['team wallets'], tension: 'Revoked mint against active freeze authority.',
});

export interface Fake { deps: DebateDeps; calls: RouteArgs[]; log: object[] }

/** A fake router: answers per role, records calls, optional delay per role. */
export function fake(answers: Partial<Record<'sound' | 'fragile' | 'reviewer', string | Error>> = {}, opts: { delay?: Partial<Record<string, number>>; cost?: number; mode?: DebateDeps['mode']; check?: DebateDeps['check']; timeoutMs?: number } = {}): Fake {
  const calls: RouteArgs[] = []; const log: object[] = [];
  const base = { sound: SOUND, fragile: FRAGILE, reviewer: REVIEW, ...answers };
  const deps: DebateDeps = {
    mode: opts.mode, check: opts.check, timeoutMs: opts.timeoutMs,
    log: (row) => log.push(row),
    route: async (args) => {
      calls.push(args);
      const role = args.payload.role;
      const d = opts.delay?.[role] ?? 0;
      if (d) await new Promise((r) => setTimeout(r, d));
      const a = base[role];
      if (a instanceof Error) throw a;
      return { content: a as string, model: `model-${role}`, cost_usd: opts.cost ?? 0.001 } satisfies RouteResult;
    },
  };
  return { deps, calls, log };
}
