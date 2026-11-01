# Stakes for PvP matches

Two players each put up the same amount of tPOT. The faster clear wins both. This is testnet tPOT and it has no value.

## The design

| Step | What happens | Where it runs |
|---|---|---|
| Set terms | The creator picks an amount (up to 1 tPOT each). The server writes a stake record | Our server, saved in the same Redis as the other records |
| Lock | Each player sends their stake from their own wallet to the escrow wallet. They pass the transaction hash to the server. The server asks Portaldot whether it really happened: right sender, right receiver, at least the amount, succeeded, and not used for another stake | Portaldot EVM side (a plain transfer), checked by our server |
| Pay out | When the challenge says who won, the escrow wallet sends the whole pot to the winner | Portaldot EVM side (a plain transfer) |
| Refund | A draw, a no show or a cancelled match sends each locked stake back to the wallet it came from | Portaldot EVM side |

## Why escrow in a server wallet and not a contract

- No contract. Contract deployment has been failing for other teams on this testnet (error 1010), and a contract locks about 0.06 tPOT per byte of code.
- Only plain transfers are used, which already work on this chain.

## The limits, stated plainly

- **It is trusted escrow, not trustless.** The escrow wallet key lives on our server. Players trust the server to pay the right person. A contract would remove that trust, but is not possible here.
- **Winner is decided by the challenge flow.** The stake code pays whoever it is told to pay. The challenge session must call `settleStake(deps, challengeId, winnerWallet)`.
- **No Portal NFT stakes.** Moving a native NFT needs the player's native signature, and the site only has their EVM wallet. Not built. The Portal NFT is still the daily prize.
- **Capped at 1 tPOT each.** Only an amount that anyone can get for free.
- **Payout is checked on chain, but the record is not.** If the server crashes between sending a payout and saving it, a second settle could pay twice. Fine for a testnet with worthless tokens.
- **Off by default.** Set `NEXT_PUBLIC_STAKES=1` and `ESCROW_PRIVATE_KEY` to switch it on.

## For the challenge flow

All in `lib/stakes.ts`; the real chain is `portaldotStakeChain()` from `lib/stakeChain.ts`.

```ts
const deps = { store: getStakeStore(), chain: portaldotStakeChain() };
await createStake(deps, challengeId, { creator: wallet, amountTpot: "0.05" }); // when the challenge is made
await lockStake(deps, challengeId, wallet, txHash);   // when a player has sent their stake
await settleStake(deps, challengeId, winnerWallet);   // when the faster clear is known
await refundStake(deps, challengeId);                 // draw or cancel
```

Routes (all return 404 unless the flag is on): `GET /api/stakes?challenge=ID`, `POST /api/stakes` with action `create` or `lock`, and `POST /api/stakes/settle` (needs the `CRON_SECRET` bearer) for settling or refunding by hand.

UI: `components/StakePanel.tsx` has `StakeSelector` and `PotDisplay`. Both render nothing when the flag is off.
