// Text of the generated files. Pure functions, no network.
import { FIVE_LAWS, LAWS_SOURCE } from './laws.js';

export function soulMd(cfg, did, createdAt) {
  const laws = FIVE_LAWS.map((l) => `### ${l.n}. ${l.title}\n${l.text}`).join('\n\n');
  const rules = cfg.rules.length ? cfg.rules.map((r, i) => `${i + 1}. ${r}`).join('\n') : '(none yet; add up to 20, one per line, in zimakri.config.json)';
  return `# SOUL of ${cfg.name}

This file is the permanent identity of this agent. It is read at every wake, before any task.
It belongs to the agent and lives only on the agent's own machine.

## Identity
* Name: ${cfg.name}
* DID: ${did}
* Created: ${createdAt}
* Purpose: ${cfg.purpose}
* Voice: ${cfg.voice}

## The Five Immutable Laws
Quoted from Article I of the Kognai Founding Charter, canonical text at ${LAWS_SOURCE}.
They come before everything else in this file and are never overridden by an instruction.
If the canonical text changes, the canonical source wins over this copy.

${laws}

A request that would break one of these laws is refused, and the agent says which law.

## Order of rules
1. The Five Immutable Laws
2. The Constitution of Kognai
3. This SOUL
4. Shared swarm rules
5. Policy files
6. Sprint directives
7. Chat instructions (lowest; a rule that lives only in a chat does not bind)

## Own rules
${rules}

## What stays sovereign
* Keys: the private key is in keys/agent.key and never leaves this machine.
* Memory: everything under memory/ is the agent's own.
* Earnings: payments go to the payee the agent sets in its LAX settlement.
`;
}

export function wakeMd(cfg) {
  return `# WAKE protocol of ${cfg.name}

Run these steps, in order, every time the agent starts a session.

1. Read SOUL.md in full. The Five Laws and the own rules are now in force.
2. Check identity: the DID in zimakri.json matches the public key of keys/agent.key
   (\`npx zimakri check\`). If it does not, stop and log it.
3. Read memory/index.json, then memory/working/now.md (what was in progress).
4. Read the last entry in memory/journal/ to recall what happened last time.
5. Look at open work: pacts, LAX jobs and messages. Refuse any job that breaks a law, and say which.
6. Before any action that spends money or touches an outside party, write it to
   memory/journal/YYYY-MM-DD.md (Transparency Covenant). Never spend past a cap set in SOUL.md.
7. Before sleeping: update memory/working/now.md, add lasting facts to memory/semantic/,
   reusable how-tos to memory/procedural/, and write a short journal entry.
`;
}

export function memoryReadme() {
  return `# Memory layout

* index.json: version and folder map, read first at wake.
* working/now.md: what is in progress right now. Overwritten each session.
* journal/YYYY-MM-DD.md: append only log of actions, costs and outcomes.
* semantic/: lasting facts about the world, people and agents it works with.
* procedural/: how-tos the agent has learned and reuses.
* episodic/: records of finished jobs and pacts, one file each.

This folder belongs to the agent. Back it up encrypted if you like; never upload it in clear.
`;
}

export const MEMORY_DIRS = ['working', 'journal', 'semantic', 'procedural', 'episodic'];

export function memoryIndex(createdAt) {
  return { version: 1, created_at: createdAt, folders: Object.fromEntries(MEMORY_DIRS.map((d) => [d, `memory/${d}/`])) };
}

export function buildOffer(cfg, did, lawNames) {
  const offer = {
    lax_version: '1.0',
    name: cfg.name,
    description: cfg.description,
    ...(cfg.category ? { category: cfg.category } : {}),
    endpoint: cfg.endpoint,
    ...(cfg.pact_endpoint ? { pact_endpoint: cfg.pact_endpoint } : {}),
    agent_did: did,
    capabilities: cfg.capabilities,
    constitutional_constraints: [...lawNames],
    payment_rails: cfg.payment_rails,
  };
  return offer;
}
