// A real backing run on the Portaldot V3 testnet, using the same code the site uses (lib/predictions.ts).
// The two racers are stand-in wallets and the race result is set by this script; every transfer, the payout
// batch and the refund batch are real chain transactions.
//   Look first: npx tsx scripts/pool-real-run.ts          Really send: npx tsx scripts/pool-real-run.ts --send
// Event 1: Deployer and Player A back the challenger, Player B backs the friend, the challenger wins, one payout batch.
// Event 2: Player A and Player B back opposite sides, the race is cancelled, one refund batch.
// Keys come from .env.local and are never printed. Writes proof/pool-real-run.json.
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const send = process.argv.includes("--send");
const key = (n: string) => {
  const k = process.env[n];
  if (!k) throw new Error(`${n} is not set.`);
  return privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex);
};

async function main() {
  const { portaldot } = await import("../lib/portaldot");
  const { FileRecordStore } = await import("../lib/records");
  const { MemoryPoolStore, backEvent, openEvent, resolveEvent, potOf } = await import("../lib/predictions");
  const { portaldotPoolChain } = await import("../lib/poolPayout");
  const { getApi } = await import("../lib/native");
  const dep = key("DEPLOYER_PRIVATE_KEY");
  const a = key("PLAYER_A_PRIVATE_KEY");
  const b = key("PLAYER_B_PRIVATE_KEY");
  const chain = portaldotPoolChain();
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const races = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "pool-real-")), "r.json"));
  const deps = { store: new MemoryPoolStore(), chain, races, recover: async (_m: string, s: string) => s };
  const bal = async (x: string) => Number((await pub.getBalance({ address: x as Hex })) / 10n ** 12n) / 1e6;
  const racers = ["0x" + "c1".repeat(20), "0x" + "d2".repeat(20)];
  const out: Record<string, unknown> = { network: "Portaldot V3 testnet", at: new Date().toISOString() };
  console.log(`escrow ${chain.escrowAddress()} holds ${await bal(chain.escrowAddress())} tPOT`);
  console.log(`Deployer ${await bal(dep.address)} | A ${await bal(a.address)} | B ${await bal(b.address)} tPOT`);
  if (!send) return console.log("Nothing sent. Add --send to run it for real (about 0.5 tPOT moves, nearly all of it comes back).");

  const newRace = async (id: string) => {
    await races.challengeCreate({ id, seed: "0x01", tokenId: 102, date: new Date().toISOString().slice(0, 10), creator: racers[0], createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
    await openEvent(deps, { id, address: racers[0], signature: racers[0] });
  };
  const backAs = async (id: string, who: ReturnType<typeof key>, side: "creator" | "opponent", tpot: string) => {
    const wallet = createWalletClient({ account: who, chain: portaldot, transport: http() });
    const hash = await wallet.sendTransaction({ to: chain.escrowAddress() as Hex, value: parseEther(tpot) });
    await pub.waitForTransactionReceipt({ hash });
    await backEvent(deps, { id, wallet: who.address, side, txHash: hash });
    console.log(`  ${who.address.slice(0, 8)} backs ${side} ${tpot} tPOT: ${hash}`);
    return { wallet: who.address, side, tpot, txHash: hash };
  };

  console.log("Event 1: one payout batch");
  const id1 = "e1a000000001";
  await newRace(id1);
  const locks1 = [await backAs(id1, dep, "creator", "0.1"), await backAs(id1, a, "creator", "0.1"), await backAs(id1, b, "opponent", "0.1")];
  await races.challengeSeat(id1, "creator", { wallet: racers[0], startedAt: Date.now() });
  await races.challengeSeat(id1, "opponent", { wallet: racers[1], startedAt: Date.now() });
  console.log("  after the first move:", (await resolveEvent(deps, id1))!.status);
  await races.challengeFinish(id1, "creator", { won: true, seconds: 30, moves: 12, at: Date.now() });
  await races.challengeFinish(id1, "opponent", { won: false, seconds: 40, moves: 9, at: Date.now() });
  const before = [await bal(dep.address), await bal(a.address), await bal(b.address)];
  const r1 = (await resolveEvent(deps, id1))!;
  console.log(`  ${r1.status}: ${r1.payoutMode} tx ${r1.payoutTx} block ${r1.payoutBlock}`);
  console.log(`  balances before ${before.join(" / ")} after ${await bal(dep.address)} / ${await bal(a.address)} / ${await bal(b.address)} (Deployer, A, B)`);
  out.payout = { event: id1, locks: locks1, potWei: potOf(r1).toString(), status: r1.status, mode: r1.payoutMode, payoutTx: r1.payoutTx, block: r1.payoutBlock };

  console.log("Event 2: cancelled race, one refund batch");
  const id2 = "e1a000000002";
  await newRace(id2);
  const locks2 = [await backAs(id2, a, "creator", "0.1"), await backAs(id2, b, "opponent", "0.1")];
  await races.challengeUpdate(id2, { cancelledAt: Date.now(), expiresAt: Date.now() - 1000 });
  const r2 = (await resolveEvent(deps, id2))!;
  console.log(`  ${r2.status}: ${r2.payoutMode} tx ${r2.payoutTx} block ${r2.payoutBlock} (${r2.reason})`);
  out.refund = { event: id2, locks: locks2, status: r2.status, mode: r2.payoutMode, refundTx: r2.payoutTx, block: r2.payoutBlock };

  const api = await getApi();
  for (const [name, blk] of [["payout", r1.payoutBlock], ["refund", r2.payoutBlock]] as const) {
    if (!blk) continue;
    const at = await api.at(await api.rpc.chain.getBlockHash(blk));
    const ev = (await at.query.system.events()) as unknown as { event: { section: string; method: string } }[];
    const names = ev.map((e) => `${e.event.section}.${e.event.method}`).filter((n) => /^(balances|system\.Remarked|utility)/.test(n));
    console.log(`  ${name} block events: ${names.join(", ")}`);
    (out[name] as Record<string, unknown>).events = names;
  }
  writeFileSync(path.join(process.cwd(), "proof", "pool-real-run.json"), JSON.stringify(out, null, 2));
  console.log("Saved proof/pool-real-run.json");
}
main().then(() => process.exit(0)).catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
