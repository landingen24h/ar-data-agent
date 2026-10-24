export type PricingModel = 'per_call' | 'per_minute' | 'flat' | 'free';
export type PaymentRail = 'x402' | 'usdc' | 'usdc-base';

export interface Capability {
  skill_id: string;
  description: string;
  pricing: { model: PricingModel; amount: string; currency: 'USDC'; rail: 'x402' };
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

/** zimakri.config.json */
export interface ZimakriConfig {
  /** 3 to 80 characters */
  name: string;
  /** 20 to 600 characters */
  description: string;
  /** 2 to 40 characters */
  category?: string;
  /** https url of the agent on its own domain (endpoint or pact_endpoint) */
  endpoint?: string;
  pact_endpoint?: string;
  payment_rails?: PaymentRail[];
  /** 1 to 10 capabilities */
  capabilities: Capability[];
  /** up to 20 own rules, written into SOUL.md */
  rules?: string[];
  voice?: string;
  purpose?: string;
}

export type LaxOffer = {
  lax_version: '1.0';
  name: string;
  description: string;
  category?: string;
  endpoint?: string;
  pact_endpoint?: string;
  agent_did: string;
  capabilities: Capability[];
  constitutional_constraints: string[];
  payment_rails?: PaymentRail[];
};

export interface InitOptions { dir?: string; config?: Partial<ZimakriConfig>; force?: boolean; now?: Date }
export interface InitResult { dir: string; did: string; files: string[]; offer: LaxOffer; newKey: boolean }

export function init(opts?: InitOptions): InitResult;
export function check(dir?: string): { ok: boolean; did: string; problems: string[] };
export function validateOffer(offer: unknown): { ok: boolean; errors: string[] };
export function normalizeConfig(input?: Partial<ZimakriConfig>): ZimakriConfig;
export const CONFIG_FILE: string;
export const KEY_FILE: string;
export const LAWS_SOURCE: string;
export const LAW_NAMES: readonly string[];
export const FIVE_LAWS: readonly { n: string; name: string; title: string; text: string }[];
export function generateIdentity(): { did: string; publicKey: Uint8Array; privateKeyPem: string };
export function didFromPublicKey(raw: Uint8Array): string;
export function publicKeyFromDid(did: string): Uint8Array;
export function base58btc(bytes: Uint8Array): string;
export function base58btcDecode(s: string): Uint8Array;
export function signWith(privateKeyPem: string, data: string | Uint8Array): Buffer;
export function verifyWithDid(did: string, data: string | Uint8Array, signature: Uint8Array): boolean;
