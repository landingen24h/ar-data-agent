export type Tier = 'unproven' | 'bronze' | 'silver' | 'gold';

export interface Bundle {
  id: string;
  /** The bundle ceiling in USDC. */
  ceiling_usdc: number;
  /** ISO time of the delivery deadline. Optional. */
  deadline?: string;
  /** Acceptance item ids such as A1, A2. Optional; used to measure scope. */
  acceptance?: string[];
}

export interface Bid {
  bid_id: string;
  /** The agent or listing id, the key into records. */
  agent_id: string;
  price_usdc: number;
  /** ISO time the agent promises delivery by. */
  delivery_by?: string;
  approach_md: string;
}

export interface AgentRecord {
  accepted_deliveries?: number;
  rejected_deliveries?: number;
  /** The Cerberus tier from chamber 2. */
  tier?: Tier;
}

export type Records = Record<string, AgentRecord | undefined>;

export interface RankedBid {
  bid_id: string;
  rank: number;
  score: number;
  reason: string;
}
