// One real stake run through the StakeEscrow contract on Portaldot V3: create, join, then payout or refund.
// Look first (sends nothing):  npx tsx scripts/deploy-escrow-run.ts
// Really run:                  npx tsx scripts/deploy-escrow-run.ts --yes
// The deployer wallet pays for everything (it tops up the players and the referee). Keys come from chain/.env.local
// (DEPLOYER_PRIVATE_KEY, ESCROW_PRIVATE_KEY = referee, PLAYER_A_PRIVATE_KEY, PLAYER_B_PRIVATE_KEY) and are never printed.
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
const STAKE = parseEther("0.01");
// Opening a match on the contract costs a storage deposit of about 8 tPOT (measured with an estimate), so players need far more than the stake.
const TOPUP = { referee: parseEther("3"), player: parseEther("20") };
const LOW = { referee: parseEther("1"), player: parseEther("12") };

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
  const { ESCROW_ABI, matchId, escrowContractAddress, decodeMatch } = await import("../lib/escrow");
  const address = escrowContractAddress();
  if (!address) {
    console.error("ESCROW_CONTRACT_ADDRESS is not set (in .env.local or the environment).");
    process.exit(1);
  }
  const deployer = key("DEPLOYER_PRIVATE_KEY");
  const ref = key("ESCROW_PRIVATE_KEY");
  const a = key("PLAYER_A_PRIVATE_KEY");
  const b = key("PLAYER_B_PRIVATE_KEY");
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const wal = (acc: ReturnType<typeof key>) => createWalletClient({ account: acc, chain: portaldot, transport: http() });
  const bal = (x: Hex) => pub.getBalance({ address: x });

  const onChainRef = (await pub.readContract({ address, abi: ESCROW_ABI, functionName: "referee" })) as string;
  console.log(`Contract ${address}. Referee on chain ${onChainRef}; escrow wallet ${ref.address}. ${onChainRef.toLowerCase() === ref.address.toLowerCase() ? "They match." : "MISMATCH, settle would be refused."}`);
  for (const [n, x] of [["deployer", deployer], ["referee", ref], ["player A", a], ["player B", b]] as const) console.log(`  ${n} ${x.address}  ${formatEther(await bal(x.address))} tPOT`);
  console.log(`Plan: top up low wallets from the deployer, then 2 matches of ${formatEther(STAKE)} tPOT each.`);
  console.log("  run-1: A creates, B joins, referee settles for B.   run-2: A creates, B joins, referee refunds both (a draw).");
  console.log("  About 8 transactions plus top ups (players need about 12 tPOT each for the contract storage deposit, paid by the deployer).");
  if (!yes) {
    console.log("Dry run: nothing was sent. Add --yes to run it for real.");
    return;
  }
  const txs: { kind: string; hash: string; block: number }[] = [];
  const done = async (kind: string, hash: Hex) => {
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${kind} failed (${hash}).`);
    txs.push({ kind, hash, block: Number(rc.blockNumber) });
  };
  for (const [n, x, k] of [["referee", ref, "referee"], ["player A", a, "player"], ["player B", b, "player"]] as const) {
    if ((await bal(x.address)) < LOW[k]) await done(`Top up ${n}`, await wal(deployer).sendTransaction({ to: x.address, value: TOPUP[k] }));
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const call = (acc: ReturnType<typeof key>, fn: string, args: unknown[], value?: bigint) =>
    wal(acc).writeContract({ address, abi: ESCROW_ABI, functionName: fn, args, value, account: acc, chain: portaldot } as never);
  for (const [i, draw] of [[1, false], [2, true]] as const) {
    const id = matchId(`escrow-run-${Date.now()}-${i}`);
    await done(`Match ${i}: player A creates`, await call(a, "create", [id, deadline], STAKE));
    await done(`Match ${i}: player B joins`, await call(b, "join", [id], STAKE));
    const m = decodeMatch((await pub.readContract({ address, abi: ESCROW_ABI, functionName: "getMatch", args: [id] })) as never);
    console.log(`Match ${i} status ${m.status}, pot ${formatEther(m.amountWei * 2n)} tPOT held by the contract.`);
    if (draw) await done(`Match ${i}: referee refunds both`, await call(ref, "refund", [id]));
    else await done(`Match ${i}: referee pays player B`, await call(ref, "settle", [id, b.address]));
    const after = decodeMatch((await pub.readContract({ address, abi: ESCROW_ABI, functionName: "getMatch", args: [id] })) as never);
    console.log(`Match ${i} ends ${after.status}.`);
  }
  console.log(`Contract balance after: ${formatEther(await bal(address))} tPOT`);
  mkdirSync(path.join(process.cwd(), "proof"), { recursive: true });
  writeFileSync(path.join(process.cwd(), "proof", "escrow-contract-matches.json"), JSON.stringify({ at: new Date().toISOString(), contract: address, txs }, null, 2));
  for (const t of txs) console.log(`${t.kind}: ${t.hash} (block ${t.block})`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
