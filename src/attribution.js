// ERC-8021 attribution tag for every Celo transaction this project sends itself
// (ERC-8004 registration, test payments). The hackathon derives the code from the
// GitHub owner/repo slug; codeFromRepo reproduces that derivation, so we assert it.
// Note: x402 settlements are sent by the facilitator, which does not carry tags yet;
// those are attributed through the PayTo address instead.
import { codeFromRepo, toDataSuffix, withAttribution } from '@celo/attribution-tags';

export const REPO = 'landingen24h/ar-data-agent';
export const ATTRIBUTION_CODE = process.env.ATTRIBUTION_CODE || codeFromRepo(REPO);

if (process.env.ATTRIBUTION_CODE && process.env.ATTRIBUTION_CODE !== codeFromRepo(REPO)) {
  // An issued code that does not match the repo slug credits nobody. Fail loudly.
  throw new Error(`ATTRIBUTION_CODE ${process.env.ATTRIBUTION_CODE} does not match ${REPO} (${codeFromRepo(REPO)})`);
}

export const dataSuffix = () => toDataSuffix(ATTRIBUTION_CODE);
export const attribution = () => withAttribution(ATTRIBUTION_CODE);
