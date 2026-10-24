// ERC-8021 attribution for every Celo transaction this project sends itself
// (ERC-8004 registration, ops). The tag is attached ONCE, where the wallet client
// is built (withAttribution), so no send path can forget it.
// x402 settlements are sent by the facilitator: the app code is declared in the 402
// response through the x402 `builder-code` extension (see pricing.js), and the PayTo
// address identifies the project until the facilitator writes Schema 2 tags.
import { createWalletClient } from 'viem';
import { toDataSuffix, withAttribution } from '@celo/attribution-tags';
import { ATTRIBUTION_CODE } from './attribution-code.js';

export { ATTRIBUTION_CODE };
export const REPO = 'landingen24h/ar-data-agent';
export const dataSuffix = () => toDataSuffix(ATTRIBUTION_CODE);
export const attribution = () => withAttribution(ATTRIBUTION_CODE);
/** viem wallet client whose sendTransaction/writeContract always carry our tag. */
export const taggedWalletClient = (opts) => createWalletClient(opts).extend(attribution());
