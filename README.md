# Potsweeper: a daily minesweeper where the Pot is the board, and winning it makes it yours

Potsweeper is a daily puzzle game on **Portaldot V3**.
There are 500 Pots. Each one gets its own minesweeper board every day, its traits change the rules, and clearing the board reveals the Pot's art.
Every day one unclaimed Pot is the **Pot of the day**. Anyone can take one ranked try, and the fastest clear **wins that Pot as a native NFT on Portaldot**.

> **Can you win today's Pot?**

Live: **https://potsweeper.vercel.app** (deploy in progress)

Built for [Portaldot Hacker House 2026](https://dorahacks.io/hackathon/portaldot-hacker-house-2026), Ecosystem DApps track.

## Try it in one minute, no wallet

1. Open **/judge**
2. Type any Pot number from 1 to 500 (try 9, a Legendary).
3. Read the rule cards, then play. Tap to open a tile. To flag, right-click, or turn on Flag mode on a phone.
4. Clear the board and the Pot's art appears.

Want more? **/practice** gives unlimited boards, and every win chains into the next Pot.

## How a board works

You open a Pot's board for today. It is the same board for everyone who opens that Pot today, and it changes at midnight UTC.

Under the tiles sits the Pot's own artwork. Each tile you clear opens a little window onto it. Clear them all and you see the whole Pot.

## Traits change the rules

Every Pot has eight traits (Tier, Shape, Clay, Glaze, Lid, Charm, Pattern, Background). Four of them change how the board plays, and every rule that fires shows up on screen with the reason.

| Trait | What it does | Pots it applies to |
|---|---|---|
| Tier | Sets the board size. Common 8 by 8 with 10 mines, up to Legendary 14 by 14 with 30 | All 500 |
| Glaze | A shiny glaze marks one safe tile before you start. Mirror, Crystal and Gold Leaf also keep the tiles around it clear | 268 of 500 |
| Lid | A solid lid (clay, iron, brass, stone) takes one hit for you | 267 of 500 |
| Charm | Any charm flags one real mine for you | 56 of 500 |

Board sizes: 307 Pots play 8 by 8, 147 play 9 by 9, 25 play 10 by 10, 15 play 12 by 12 and 6 play 14 by 14.

The Pots are drawn by `scripts/gen-pots.mjs`, a seeded generator, so anyone can rebuild the exact same 500 Pots from the code. The patterns include Adire and Kente.

## Win the Pot of the day

1. Each UTC day, one unclaimed Pot is featured.
2. Connect any wallet and sign a message (no gas, no transaction) to take your one ranked try. The server starts the clock when you press Start.
3. Just after midnight UTC, the fastest clear wins. The Pot is minted to the winner with Portaldot's native NFT pallet (`pallet-nfts`).
4. The NFT goes to the native account that Portaldot links to your 0x wallet, so it shows up for that wallet with no extra setup.

Which Pot is featured can be worked out by anyone: `keccak256("pot-of-the-day:DATE:FINGERPRINT") mod 500 + 1`, stepping forward past Pots already won and the Pot featured the day before.

## Fairness you can check yourself

A daily puzzle is only fun if nobody can change the board after seeing who played. So each day works like a sealed envelope:

1. **Morning:** the site makes a secret for the day and posts only its fingerprint on Portaldot. The fingerprint is a short code that matches that one secret and no other.
2. **During the day:** the secret stays hidden, so nobody can work out where the mines are.
3. **After the day ends:** the secret is published. Anyone can check it matches the fingerprint posted that morning, then rebuild any Pot's board and compare.

Check a past day at **/verify**. It takes about a minute: pick a day and a Pot, and the page shows match or mismatch. Your browser asks Portaldot directly, so the answer does not rely on our server.

What this proves: the boards were fixed before anyone played and were not changed afterwards.
What it does not prove: the site itself can see the secret during the day.

## How it uses Portaldot

Portaldot V3 runs two sides on one chain, and Potsweeper uses both:

| Side | What Potsweeper does there |
|---|---|
| EVM side (pallet-revive, chain id 420420777) | The daily fingerprint post: a 0 value transaction with the fingerprint as its data. Your wallet connects and signs here |
| Native side (pallet-nfts) | The Pot collection. Each Pot of the day winner gets a real native NFT |
| The link between them | pallet-revive maps an 0x wallet to the native account `0x… ++ 0xEE × 12`. Potsweeper mints to that account, so the 0x wallet owns the Pot |

Why native NFTs and not a Solidity contract: on the V3 testnet a contract locks a storage deposit of about 0.06 tPOT per byte of code (`revive.depositPerByte`). A small ERC-721 would lock hundreds of tPOT. A native NFT mint locks about 0.1 tPOT (`nfts.itemDeposit`).

### On-chain record so far

| What | Where |
|---|---|
| First fingerprint post, 2026-10-22 | EVM tx `0xbdab89b89b034f57296e912129cc45b093eb5403e4682dbfa3f23791bd01b872`, [block 148888](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/148888) |
| Fingerprint poster wallet | `0x6cE5b32C1747442ff480DC1ce60a2b229CCa0F82` |
| Pot collection (pallet-nfts) | Created next, once the issuer account is funded |

## Reasons to come back

| Feature | What it is |
|---|---|
| Daily board | One board per Pot per day. Its record and streak belong to the Pot, so they stay with it if it changes hands |
| Pot of the day | One shared board for everyone. One ranked try per wallet. Fastest clear wins the Pot as an NFT |
| My Pots | Connect the wallet that holds your Pots. Each one gets a ranked board every day |
| Streaks | Current and best streak, with a "clear today to keep it" reminder |
| Reveal wall | All 500 Pots, filling in with art as players clear them |
| Hall | Today's top 10 and yesterday's winner |
| Share card | A picture of the revealed Pot with the board size, time, date and that day's fingerprint |
| Practice | Unlimited unranked boards for any Pot, no wallet |

## What this is not

- **The board is sent to your browser.** The game runs in the browser, so a determined cheater could read the mines. The ranked try is timed by the server and you get one per wallet, but someone with many wallets gets many tries. Moving the board to the server is next on the list.
- **The fairness check has a limit.** It proves boards were not changed afterwards, not that the site never saw the secret.
- **No Pot has been won yet.** The award flow is tested (see `lib/award.test.ts`), but the first real mint happens after the first day with a winner.
- **The Pots are my own design.** The art and the trait rules come from the generator in this repo.
- **Records live on a free database.** That is fine for now, but it is not built for a large crowd.
- **Testnet only.** Portaldot V3 is a testnet, and tPOT has no value.

## Where this came from

Potsweeper is a remix of my own game, [Chogsweeper](https://github.com/Sireadell/chogsweeper) (October 2026), which ran on Monad for an existing NFT collection. For Portaldot I replaced the NFT collection with 500 generated Pots, moved the fingerprint posts to Portaldot, dropped the paid Daily Pot and the token hint, and added the win-the-Pot flow on Portaldot's native NFT pallet.

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer and [Git](https://git-scm.com).

```bash
git clone https://github.com/Sireadell/potsweeper.git
cd potsweeper
npm install
npm run dev      # a local secret is created for you the first time
```

Then open http://localhost:3000.

Run the tests:

```bash
npm test
```

Redraw the 500 Pots (same result every time):

```bash
node scripts/gen-pots.mjs
node scripts/build-wall-mosaic.mjs
```

Preview a day's fingerprint post without sending anything:

```bash
npx tsx scripts/post-commit.ts --dry-run
```

### Server settings (hosted)

| Variable | What it is |
|---|---|
| `POT_SALT_SECRET` | Long random value; the daily secrets are made from it |
| `POSTER_PRIVATE_KEY` | Key of the small EVM wallet that posts the daily fingerprint |
| `ISSUER_MNEMONIC` | Key of the native account that owns the Pot collection and mints the winners' Pots |
| `POT_COLLECTION_ID`, `NEXT_PUBLIC_POT_COLLECTION_ID` | The pallet-nfts collection id |
| `CRON_SECRET` | Protects the two daily timers |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Records store |

Nothing secret is ever written in this repo.

## Built with

| Part | Role |
|---|---|
| Portaldot V3 testnet | Daily fingerprints (EVM side) and the Pot NFTs (native pallet-nfts) |
| Next.js, viem and @polkadot/api | The site, the EVM reads and the native NFT calls |
| Upstash Redis | Records, streaks, the wall, Pot of the day and claims |
| Vercel | Hosting and the two daily timers |
