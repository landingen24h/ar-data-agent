export type Network = 'base' | 'base-sepolia';

/** x402 version 1 payment requirements (one entry of accepts). */
export interface PaymentRequirements {
  scheme: 'exact';
  network: Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

/** The decoded X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown;
}

export interface VerifyResult { isValid: boolean; invalidReason?: string; payer?: string }
export interface SettleResult { success: boolean; transaction: string; network: string; errorReason?: string; payer?: string }

export interface Facilitator {
  verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResult>;
  settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResult>;
}

/** The paid work. It runs only after the payment is verified and settled. */
export type Work = (request: Request) => Promise<unknown> | unknown;

export interface AppConfig {
  /** Decimal USDC, for example "0.01". */
  price: string;
  payTo: string;
  network: Network;
  /** A facilitator object, or the https URL of one (verify and settle over HTTP). */
  facilitator: Facilitator | string;
  description?: string;
  work?: Work;
  maxTimeoutSeconds?: number;
}
