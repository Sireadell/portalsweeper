# How Portalsweeper uses Portaldot

This page is for other teams building on the Portaldot V3 testnet. Everything here is open source under the MIT licence (see `LICENSE` at the repo root), so copy what helps.

Each claim below is marked. **Checked live** means we read it from the running chain ourselves. **Not live yet** means the code is written and tested but has not run on the chain.

## What we use

| Feature | What it does here | Where to look in the repo |
|---|---|---|
| EVM side (pallet-revive) | Daily fingerprint posts as 0-value transactions. Checked live, running since 22 Oct 2026 | `scripts/post-commit.ts`, `lib/commits.ts` |
| DailyLedger contract (Solidity on Revive) | Holds each day's fingerprint, checks the revealed secret itself, records the winner. Not live yet | `contracts/DailyLedger.sol`, `lib/ledger.ts` |
| Native NFT module (pallet-nfts) | The 500 Portals, collection 5. Collection checked live, nothing minted yet | `lib/native.ts`, `scripts/mint-portal.ts` |
| Babe randomness | A random number made by the chain after the fingerprint, mixed into the board. Read live from past blocks, not switched on in the game yet | `lib/chainRandom.ts`, `lib/engine.ts` |
| Identity module | Reads the display name a wallet has set. Checked live | `lib/identity.ts` |
| Assets module, seen as ERC-20 | The planned SHARD token. Address rule checked live on an existing token. SHARD itself not created yet | `lib/shardToken.ts`, `scripts/create-shard.ts` |

## Deploy the ledger from a normal wallet

Both scripts have a free dry run. Without `--yes` they ask the chain what the deploy would cost and send nothing.

**Route 1, from an 0x wallet:** `scripts/deploy-ledger.ts`

```bash
npx tsx scripts/deploy-ledger.ts              # dry run, sends nothing
npx tsx scripts/deploy-ledger.ts --yes        # deploys, prints the address and block
```

The wallet that deploys becomes the only wallet allowed to write to the ledger. Pass `--writer 0x...` to name a different one.

**Route 2, from a native `5...` account:** `scripts/deploy-ledger-native.ts`. This sends `revive.instantiateWithCode` as a normal Portaldot transaction. Use it if the 0x route is refused.

```bash
npx tsx scripts/deploy-ledger-native.ts --writer 0x...          # dry run through the chain's own reviveApi
npx tsx scripts/deploy-ledger-native.ts --writer 0x... --yes
```

On this route the constructor argument (the writer address, ABI encoded) has to be **appended to the end of the contract code**, and the separate data field left empty (`0x`). We first sent it in the data field and the chain's dry run answered `revive.EvmConstructorNonEmptyData`. With the argument moved onto the code, the only answer left was that our paying account had no funds.

Status: neither route has deployed yet, because our deploying wallets hold no test coins today. When it is deployed, the address goes in this file and in the README.

## Call the ledger

A day is a number: 2026-11-05 is `20261105`. The fingerprint is `keccak256` of the secret as 32 raw bytes.

```ts
import { createPublicClient, http, keccak256, type Hex } from "viem";
import artifact from "../contracts/DailyLedger.json";
import { portaldot } from "../lib/portaldot"; // chain id 420420777, RPC https://test-evm-rpc-v3.portaldot.dev

const pub = createPublicClient({ chain: portaldot, transport: http() });
const ledger = { address: LEDGER as Hex, abi: artifact.abi };
const salt = SECRET as Hex; // 32 bytes, kept private until the day is over

await wallet.writeContract({ ...ledger, functionName: "commit", args: [20261105, keccak256(salt)] }); // before play, writer only
const day = await pub.readContract({ ...ledger, functionName: "getDay", args: [20261105] }); // [commit, committedAt, chainRandom, randomBlock, revealed]
const ok = await pub.readContract({ ...ledger, functionName: "matches", args: [20261105, salt] }); // true or false, free
```

`wallet` is a viem wallet client for the writer. After the day, anyone can call `reveal(day, salt)`, and the contract refuses a secret that does not match. `recordWinner(day, portal, winner, moveLogHash)` only works once the day is revealed.

## 0x wallets and `5...` accounts

Portaldot links each 0x wallet to a native account. The native account is the 20 byte 0x address followed by twelve `0xEE` bytes, written in the usual `5...` form. This matches the chain's own `reviveApi.accountId` answer in the official testnet guide. Our mint script sends Portals to that account, so the 0x wallet will own them with no extra setup (no Portal has been minted yet). Sending tPOT to that `5...` account funds the 0x wallet. Code: `mappedAccount` and `walletOf` in `lib/native.ts`.

## Native tokens as ERC-20

Every token made with the Assets module can also be read as an ERC-20 at a fixed address: the asset id as 4 bytes, then twelve zero bytes, then `00010000`.

Checked live: asset 7777 (pUSD) sits at `0x00001e6100000000000000000000000000010000`, and calling it through the EVM side answered name `pUSD` and 6 decimals. Code: `assetErc20Address` in `lib/shardToken.ts`.

## What we learned

| Gotcha | What to do |
|---|---|
| Native route deploy refused with `revive.EvmConstructorNonEmptyData` | Put the encoded constructor arguments on the end of the code and send empty data |
| Deploying costs mostly a storage deposit, not gas | Our 2042 byte contract was estimated at about 162.7 tPOT through the 0x route. Check with the dry run before asking for coins |
| A contract cannot read Babe randomness by itself | The EVM block field `mixHash` is a fixed number here. Read `babe.randomness` on the native side and store it, with the block it came from, so anyone can check |
| Only 2 validators on the testnet | Babe randomness can be nudged by one of them. Say so to your players |
| Hash the secret as bytes, not as text | `keccak256` of the 32 raw bytes and of the hex string give different answers. Our tests caught this |
| The node keeps old state | You can read a past block's random number later, which makes checking a past day possible |
| Two decimal counts for tPOT | 14 on the native side, 18 on the EVM side, so 1 native unit is 10,000 EVM units |
| No EVM explorer | Use the Node Console at `node-console.portaldot.dev` and show transaction hashes and block numbers on your own pages |
| No public faucet | Test coins come from the event admins, sent to your `5...` account |
| Error 1010 ("Invalid Transaction") | Plain transactions from our 0x wallet go through fine. Whether a contract creation from an 0x wallet does is not tested by us yet, which is why route 2 exists |

## Licence

MIT. Use the contract and the helpers in your own game, and tell us if you do.
