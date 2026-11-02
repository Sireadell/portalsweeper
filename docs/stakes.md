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
- **Winner is decided by the challenge code.** The stake code pays whoever it is told to pay. `resolveChallengeStake` in `lib/challenge.ts` asks `getChallengeWinner` and only pays once the challenge is settled.
- **No Portal NFT stakes.** Moving a native NFT needs the player's native signature, and the site only has their EVM wallet. Not built. The Portal NFT is still the daily prize.
- **Capped at 1 tPOT each.** Only an amount that anyone can get for free.
- **Payout is checked on chain, but the record is not.** A claim on the challenge id stops two calls paying at the same moment, and a failed send releases the claim so it can be retried. But if the server crashes between sending a payout and saving it, a second settle could pay twice. Fine for a testnet with worthless tokens.
- **Money sent after the challenge ends.** The lock route refuses a challenge that is already over, but a player who sends tPOT in the seconds around the end could lose it. Another reason this is testnet only.
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

## How it joins friend challenges

Everything below only happens when `NEXT_PUBLIC_STAKES=1`. With the flag off, challenges work exactly as before and ignore any stake in the request.

| Step | What happens |
|---|---|
| Make | On `/challenge` the creator picks 0, 0.01, 0.05 or 0.1 tPOT. `createChallenge` checks the amount with the same limits as `parseTpot` (capped at 1 tPOT), makes the challenge, then `createStake` with the challenge id and the creator's wallet |
| Lock | The room shows "Lock X tPOT". The player's wallet sends that amount to the escrow wallet and the page passes the transaction hash to `/api/stakes`, which checks it on Portaldot. The lock route refuses a challenge that is already over |
| Start | `startChallenge` refuses to seat anyone until both stakes are locked, and only the two wallets that locked can sit. Nobody plays for free |
| Pay out | When the challenge is settled with a winner, `settleStake` sends the whole pot to the winner. Done by whoever sees the result first: the move that ends the game, the next read of the challenge page, or the timer |
| Refund | A draw, an expired link, a locked player whose opponent never turned up, or a stake nobody locked is closed with `refundStake` |
| Show | The result screen shows the stake, the pot, and the payout or refund transactions. V3 has no transaction explorer, so each links to its block in the Node Console and shows the transaction hash |

Safe to repeat: a stake that is already settled or refunded is returned as it is, so reading the page again or the timer running again never pays twice.

Timer: `GET /api/cron/stakes` (bearer `CRON_SECRET`, in `vercel.json`, once a day just after the award) goes through every stake still open or locked and settles or refunds the ones whose challenge is over. It is a backstop, because opening the challenge page does the same job at once.

Tested only against a fake chain (`lib/challengeStakes.test.ts`): create with a stake, join, both lock, play, winner paid once, draw and expiry refunds, one sided lock refund, a failed send retried, flag off changes nothing. No real transaction has been sent.
