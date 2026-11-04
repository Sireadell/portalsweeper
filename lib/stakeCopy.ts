export const STAKE_COPY = {
  "heading": "A real stake run",
  "intro": "On 4 Nov 2026 we ran two staked matches on Portaldot with test coins. We used two throwaway test wallets, and each one staked 0.01 tPOT. One match ended in a win and the other in a draw.",
  "steps": {
    "topup": "Test wallet topped up",
    "lockA": "Player A locks 0.01 tPOT",
    "lockB": "Player B locks 0.01 tPOT",
    "payout": "Winner paid the pot",
    "refund": "Draw stake refunded"
  },
  "trustNote": "The escrow wallet is ours, and our server moves the coins. So this run shows the flow works on the chain, not that it is trustless.",
  "checkNote": "Each row links to its block in the chain explorer, and this page reads the receipt again from Portaldot every time you open it."
} as const;
