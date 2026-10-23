// ERC-8004 deployments this viewer targets. Source: the official deployments list in
// https://github.com/erc-8004/erc-8004-contracts (README, "Base Mainnet" and "Base Sepolia"), checked on chain 2026-10-23.
export const REGISTRIES = {
  base: {
    chainId: 8453,
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    rpcUrl: 'https://mainnet.base.org',
  },
  'base-sepolia': {
    chainId: 84532,
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    rpcUrl: 'https://sepolia.base.org',
  },
};
// ipfs.io, dweb.link and w3s.link answer 429 to API style requests since 2026; this one served JSON on 2026-10-23.
export const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
// The Sepolia test identity Kognai publishes on this bundle. Not published yet on 2026-10-23: set it here at M2.
export const KOGNAI_TEST_IDENTITY = { network: 'base-sepolia', agentId: null };
