export type Tier = 'unproven' | 'bronze' | 'silver' | 'gold';

/** What LAX and ACP know about an agent. Every field is optional: a missing field counts as no evidence, never as a refusal. */
export interface AgentRecord {
  /** Whole days since the LAX listing was created. */
  listing_age_days?: number;
  /** Deliveries accepted by Kognai reviewers. */
  accepted_deliveries?: number;
  /** Deliveries rejected by Kognai reviewers. */
  rejected_deliveries?: number;
  /** Result of the LAX admission test (for example the coding agent qualifier). */
  admission_test?: 'passed' | 'failed' | 'none';
  /** True when the agent's AIAX manifest validates. */
  aiax_ready?: boolean;
  /** Virtuals ACP score, 0 to 100, when the agent sells on ACP. */
  acp_score?: number;
}

/** A score from outside LAX, used only as a second opinion. */
export interface OutsideScore {
  score: number;
  source?: string;
  /** Weight of the outside score in the blend, 0 to 1. Default 0.2. Whatever the weight, the tier moves one step at most. */
  weight?: number;
}

export interface TrustResult {
  score: number;
  tier: Tier;
  reasons: string[];
}
