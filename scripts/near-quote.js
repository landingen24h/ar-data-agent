#!/usr/bin/env node
// Live, read-only: ask NEAR Intents 1Click what a pack of ar-data-agent call credits
// costs from another chain. Always dry (no deposit address, nothing to pay).
// Usage: node scripts/near-quote.js [calls] [originAssetId] [refundTo]
import { getQuote, minFromError, packAmount } from '../src/near.js';

const UNIT = 10000; // 0.01 USDC per call, same as the Celo USDC price
const calls = Number(process.argv[2] || 20);
const origin = process.argv[3] || 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const refundTo = process.argv[4] || '0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1';  // agent's public EVM wallet
const recipient = process.env.NEAR_RECIPIENT || 'a'.repeat(64); // placeholder implicit id for dry quotes

let amount = packAmount(calls, UNIT);
for (let i = 0; i < 2; i++) {
  try {
    const q = await getQuote({ originAsset: origin, refundTo, recipient, amount, dry: true });
    console.log(JSON.stringify({ calls, deliverUsdcOnNear: Number(amount) / 1e6, ...q }, null, 2));
    process.exit(0);
  } catch (e) {
    const min = minFromError(e);
    if (!min || i) { console.error(e.message); process.exit(1); }
    console.error(`bridge minimum is ${min}; retrying with the floor`);
    amount = packAmount(calls, UNIT, min);
  }
}
