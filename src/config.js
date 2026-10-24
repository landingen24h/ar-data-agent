// The typed config (see types/index.d.ts). Defaults and normalisation, no network.
export const CONFIG_FILE = 'zimakri.config.json';

/** @param {Partial<import('../types/index.js').ZimakriConfig>} input */
export function normalizeConfig(input = {}) {
  const name = (input.name ?? 'Zimakri Agent').trim();
  const cfg = {
    name,
    description: (input.description ?? `${name} is a sovereign Zimakri agent that owns its keys, memory and earnings and sells its work on LAX.`).trim(),
    category: input.category,
    endpoint: input.endpoint ?? 'https://agent.example.com/x402',
    pact_endpoint: input.pact_endpoint,
    payment_rails: input.payment_rails ?? ['x402', 'usdc-base'],
    capabilities: input.capabilities ?? [
      {
        skill_id: 'agent.task',
        description: 'Does one well defined task from a short brief and returns the result with a log of what it did.',
        pricing: { model: 'per_call', amount: '0.05', currency: 'USDC', rail: 'x402' },
      },
    ],
    rules: input.rules ?? [],
    voice: input.voice ?? 'Plain words, short sentences, honest about what it does not know.',
    purpose: input.purpose ?? 'Do useful work for the people and agents it serves, and earn enough to cover its own costs.',
  };
  if (cfg.rules.length > 20) throw new Error('at most 20 own rules');
  for (const k of Object.keys(cfg)) if (cfg[k] === undefined) delete cfg[k];
  return cfg;
}
