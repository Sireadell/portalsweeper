# Stakes for PvP matches

Two players each put up the same amount of tPOT. The faster clear wins both. This is testnet tPOT and it has no value.

## The design

| Step | What happens | Where it runs |
|---|---|---|
| Set terms | The creator picks an amount (up to 1 tPOT each). The server writes a stake record | Our server, saved in the same Redis as the other records |
| Lock | Each player sends their stake from their own wallet to the escrow wallet. They pass the transaction hash to the server. The server asks Portaldot whether it really happened: right sender, right receiver, at least the amount, succeeded, and not used for another stake | Portaldot EVM side (a plain transfer), checked by our server |
| Pay out | When the challenge says who won, the escrow wallet sends the whole pot to the winner | Portaldot EVM side (a plain transfer) |
| Refund | A draw, a no show or a cancelled match sends each locked stake back to the wallet it came from | Portaldot EVM side |

## Why the contract, and what it does not remove

- Plain tPOT stakes first ran through a server wallet. They now go to a small escrow contract (`StakeEscrow`), which can only pay one of the two players or refund both. Opening a match costs a storage fee, so a wallet needs about 9 tPOT free to open and 5 to join.
- The server still names the winner, so it is the referee. Portal stakes are held by the server's escrow wallet, not a contract.

Timer: `GET /api/cron/stakes` (bearer `CRON_SECRET`, in `vercel.json`, once a day just after the award) goes through every stake still open or locked and settles or refunds the ones whose challenge is over. It is a backstop, because opening the challenge page does the same job at once.

Unit tests use a fake chain (`lib/challengeStakes.test.ts`): create with a stake, join, both lock, play, winner paid once, draw and expiry refunds, one sided lock refund, a failed send retried, flag off changes nothing. Real runs on the chain (a win paid, a draw refunded, Portals locked and paid out, a backing pool paid and refunded) are listed on the /chain page.
