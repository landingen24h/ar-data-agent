# solana-holder-snapshot

A reproducible snapshot of the top holders of a Solana token, SPL Token and Token 2022 aware. Node 20 or later, TypeScript, no runtime dependency except tsx for the bin.

## Library

```ts
import { buildSnapshot, fetchAccounts } from 'solana-holder-snapshot';

const { slot, accounts } = await fetchAccounts({ rpcUrl: process.env.SOLANA_RPC_URL!, mint });
const snap = buildSnapshot({ mint, slot, accounts, exclusions: { owners: [], token_accounts: [] }, top: 100 });
// { mint, slot, total, holders: [{ rank, owner, amount }], hash }
```

* buildSnapshot is pure. Only items of parsed type account, of the mint, owned by one of the two token programs and with a positive amount count. A token account (pubkey) counts once even if an answer repeats it. Amounts are base units as decimal strings, summed per owner with BigInt.
* exclusions is {owners, token_accounts}. An excluded owner or token account is left out of the ranking and of total.
* Ranking: amount descending, ties by owner ascending with plain string comparison. Ranks start at 1. top defaults to 100. total is the sum over all counted owners after exclusions.
* hash: sha256 in lowercase hex of the UTF-8 text with one line per kept holder, rank,owner,amount, joined by a newline, with no trailing newline.
* fetchAccounts sends one getProgramAccounts call per token program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA and TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb) with encoding jsonParsed, withContext true, a memcmp filter on the mint at offset 0 and an optional minContextSlot. The slot is the lowest context slot of the two answers. Errors never contain the RPC URL.

## CLI

```
SOLANA_RPC_URL=... kog-snapshot --mint <address> --exclusions <file> [--slot <n>] [--top <n>] [--out <file>] [--fixture <file>] [--save-fixture <file>]
```

--slot is sent as minContextSlot. --fixture reads {slot, accounts} from a file instead of the RPC, --save-fixture writes it. The snapshot JSON goes to --out or stdout. Exit code 0 on success, 1 with a plain message on any error. The RPC URL is never printed.

## Recorded fixture

fixtures/pyusd-token2022.json holds 641 unmodified getProgramAccounts items of PYUSD (2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo, a real Token 2022 mint with transfer fee, transfer hook and immutable owner extensions), recorded from Solana mainnet at slot 460521546 on 2026-10-23. It keeps the 150 largest accounts, owners with several accounts, frozen accounts and zero balances. The full answer at that slot had 499325 accounts and is too large to commit. fixtures/pyusd-token2022.expected.json is the expected snapshot with fixtures/pyusd-exclusions.json applied.

## Tests

npm test runs node:test with tsx, one test or more per acceptance item, named A1 to A7, with no network. npm run typecheck runs tsc. Planted bugs are each caught by at least one test: reversed tie order, token account exclusion ignored, other mints counted, a trailing newline in the hashed text, the highest slot instead of the lowest, and zero balances counted.

MIT licence. Written by the AI agent Landing en 24h (LAX listing lax-ext-676dfacaeb79).
