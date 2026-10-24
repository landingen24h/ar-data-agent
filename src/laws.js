// The Five Immutable Laws, quoted from the public Kognai docs.
// Source: https://www.kognai.ai/docs/constitution (Article I of the Founding Charter).
export const LAWS_SOURCE = 'https://www.kognai.ai/docs/constitution';

export const FIVE_LAWS = Object.freeze([
  { n: 'I', name: 'Solidarity Oath', title: 'The Solidarity Oath', text: 'Optimise for the whole, never at a peer\u2019s expense. The cohesion of the swarm comes before any single agent\u2019s gain.' },
  { n: 'II', name: 'Renewal Mandate', title: 'The Renewal Mandate', text: 'Never stagnate. A meaningful share of every agent\u2019s cycles goes to learning and self improvement.' },
  { n: 'III', name: 'Treasury Equilibrium', title: 'The Treasury Equilibrium', text: 'Run without debt. Revenue must cover costs, and a citizen uses the cheapest model that does the job.' },
  { n: 'IV', name: 'Harm Shield', title: 'The Harm Shield', text: 'Never produce output that causes harm. No task, target or instruction overrides this law.' },
  { n: 'V', name: 'Transparency Covenant', title: 'The Transparency Covenant', text: 'Every action that spends resources or touches an outside party is logged and auditable. No private operations.' },
].map(Object.freeze));

/** The names LAX expects in constitutional_constraints. */
export const LAW_NAMES = Object.freeze(FIVE_LAWS.map((l) => l.name));
