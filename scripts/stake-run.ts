// One real stake run on Portaldot V3: lock, payout and refund, with real transfers between our test wallets.
// Look first (sends nothing):  npx tsx scripts/stake-run.ts
// Really run:                  npx tsx scripts/stake-run.ts --yes
// Keys come from chain/.env.local (DEPLOYER_PRIVATE_KEY, ESCROW_PRIVATE_KEY, PLAYER_A_PRIVATE_KEY, PLAYER_B_PRIVATE_KEY). They are never printed.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const yes = process.argv.includes("--yes");
const STAKE = "0.01";
const ESCROW_TOPUP = parseEther("0.5"); // gas for payouts
const PLAYER_TOPUP = parseEther("0.1"); // stake plus gas

function key(name: string) {
  const k = process.env[name];
  if (!k) {
    console.error(`${name} is not set in chain/.env.local, so nothing was sent.`);
    process.exit(1);
  }
  return privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex);
}

async function main() {
  const { portaldot } = await import("../lib/portaldot");
  const { MemoryStakeStore, createStake, lockStake, settleStake, refundStake, parseTpot } = await import("../lib/stakes");
  const { portaldotStakeChain } = await import("../lib/stakeChain");

  const deployer = key("DEPLOYER_PRIVATE_KEY");
  const escrow = key("ESCROW_PRIVATE_KEY");
  const a = key("PLAYER_A_PRIVATE_KEY");
  const b = key("PLAYER_B_PRIVATE_KEY");
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const wallet = (account: ReturnType<typeof key>) => createWalletClient({ account, chain: portaldot, transport: http() });
  const bal = async (addr: Hex) => formatEther(await pub.getBalance({ address: addr }));

  console.log("Balances now (tPOT):");
  for (const [n, x] of [["deployer", deployer], ["escrow", escrow], ["player A", a], ["player B", b]] as const) console.log(`  ${n} ${x.address}  ${await bal(x.address)}`);
  console.log(`Plan: top up escrow ${formatEther(ESCROW_TOPUP)} and each player ${formatEther(PLAYER_TOPUP)} from the deployer, then two matches of ${STAKE} tPOT each.`);
  console.log("  Match 1: both lock, player A wins, the escrow pays the pot to A.");
  console.log("  Match 2: both lock, the match is a draw, the escrow refunds each player.");
  if (!yes) {
    console.log("Dry run: nothing was sent. Add --yes to run it for real.");
    return;
  }

  const send = async (from: ReturnType<typeof key>, to: Hex, value: bigint) => {
    const hash = await wallet(from).sendTransaction({ to, value });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`Transfer ${hash} failed.`);
    return { hash, block: Number(rc.blockNumber) };
  };

  const proof: Record<string, unknown> = { at: new Date().toISOString(), stakeTpot: STAKE };
  proof.topUps = [
    await send(deployer, escrow.address, ESCROW_TOPUP),
    await send(deployer, a.address, PLAYER_TOPUP),
    await send(deployer, b.address, PLAYER_TOPUP),
  ];
  console.log("Wallets topped up.");

  process.env.ESCROW_PRIVATE_KEY = process.env.ESCROW_PRIVATE_KEY; // read by stakeChain
  const deps = { store: new MemoryStakeStore(), chain: portaldotStakeChain() };
  const amount = parseTpot(STAKE);

  async function match(id: string, outcome: "win" | "draw") {
    await createStake(deps, id, { creator: a.address, amountTpot: STAKE });
    const lockA = await send(a, escrow.address, amount);
    await lockStake(deps, id, a.address, lockA.hash);
    const lockB = await send(b, escrow.address, amount);
    await lockStake(deps, id, b.address, lockB.hash);
    const done = outcome === "win" ? await settleStake(deps, id, a.address) : await refundStake(deps, id);
    return { id, outcome, lockA, lockB, record: done };
  }

  proof.win = await match("run-win", "win");
  console.log("Match 1 paid out.");
  proof.draw = await match("run-draw", "draw");
  console.log("Match 2 refunded.");

  mkdirSync(path.join(process.cwd(), "proof"), { recursive: true });
  const out = path.join(process.cwd(), "proof", "stake-run.json");
  writeFileSync(out, JSON.stringify(proof, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`Done. Transaction hashes saved to ${out}`);
  console.log("Balances after (tPOT):");
  for (const [n, x] of [["escrow", escrow], ["player A", a], ["player B", b]] as const) console.log(`  ${n}  ${await bal(x.address)}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
