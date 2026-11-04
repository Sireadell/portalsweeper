// Dry run for the Remark note, the Scheduler call, TransactionStorage, and the Oracle and Lottery checks.
// Nothing is sent: each call is built from the live chain's metadata and the node is asked to estimate it as an
// Ethereum transaction from the deployer wallet, the same route a real send would use.
//   npx tsx scripts/chain-notes-dryrun.ts
//   npx tsx scripts/chain-notes-dryrun.ts --send remark|store     really sends that one from the deployer wallet (fee only)
// Why --send exists: Remark and TransactionStorage need to run inside a real block, so the node's estimate says
// BadContext for them even when a real send works.
// Real runs use the same data with sendTransaction (see scripts/test-ethsubstrate.ts). The key is never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot as chain } from "../lib/portaldot";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

async function main() {
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const { ethCallData, PALLETS_ADDRESS } = await import("../lib/swap");
  const { dayNote, remarkCall } = await import("../lib/remark");
  const { scheduleDayNote } = await import("../lib/scheduler");
  const { storeCall, storeFee } = await import("../lib/storage");
  const { dailyCommit, utcToday, addDays } = await import("../lib/salt");

  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw) throw new Error("DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
  const pub = createPublicClient({ chain, transport: http() });

  const sendIdx = process.argv.indexOf("--send");
  const sendWhat = sendIdx >= 0 ? process.argv[sendIdx + 1] : null;
  const { createWalletClient } = await import("viem");
  const real = async (label: string, call: { method: { toHex(): string } }) => {
    const wallet = createWalletClient({ account, chain, transport: http() });
    const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(call as never), value: 0n, gas: 2_000_000_000_000n });
    const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const bh = await api.rpc.chain.getBlockHash(Number(rcpt.blockNumber));
    const evs = ((await (await api.at(bh)).query.system.events()) as unknown as { toHuman(): unknown }[]).map((e) => JSON.stringify(e.toHuman()));
    const hit = evs.filter((e) => /Stored|Remark|Scheduled|ExtrinsicFailed/i.test(e) && !/TransactionFeePaid/.test(e));
    console.log(`${label}: SENT ${hash} status ${rcpt.status} block ${rcpt.blockNumber}; native events: ${hit.length ? hit.join(" ; ").slice(0, 600) : "none matched"}`);
  };

  const ask = async (label: string, call: { method: { toHex(): string } }) => {
    const data = ethCallData(call as never);
    try {
      const gas = await pub.estimateGas({ account: account.address, to: PALLETS_ADDRESS, data, value: 0n });
      console.log(`${label}: node accepted, gas ${gas}`);
    } catch (e) {
      const x = e as { details?: string; shortMessage?: string };
      console.log(`${label}: node says: ${(x.details ?? x.shortMessage ?? (e as Error).message).slice(0, 300)}`);
    }
  };

  // The commit helper needs the server secret; a throwaway one is enough for a dry run.
  process.env.PORTAL_SALT_SECRET ??= "dry-run-only";
  const today = utcToday();
  const tomorrow = addDays(today, 1);
  const note = dayNote({ date: today, commit: dailyCommit(today) });
  console.log("note:", note);
  await ask("B6 Remark.store day note", remarkCall(api, note));

  if (sendWhat === "remark") await real("B6 Remark.store day note", remarkCall(api, note));
  const head = await api.rpc.chain.getHeader();
  const ts = Number((await (await api.at(head.hash)).query.timestamp.now()).toString());
  const sch = scheduleDayNote(api, { date: tomorrow, commit: dailyCommit(tomorrow), headBlock: head.number.toNumber(), headTimeMs: ts });
  console.log(`B6 Scheduler: tomorrow's note would run at block ${sch.when} (now ${head.number.toNumber()})`);
  await ask("B6 Scheduler.scheduleNamed tomorrow's note", sch.call);

  const log = Array.from({ length: 60 }, (_, i) => ({ action: "reveal", idx: i, t: i * 900 }));
  const bytes = new TextEncoder().encode(JSON.stringify(log)).length;
  console.log(`B7 TransactionStorage: ${bytes} bytes, chain fee ${await storeFee(api, bytes)} raw units, kept ${(await api.query.transactionStorage.retentionPeriod?.())?.toString() ?? "about 100800 blocks (7 days)"} blocks`);
  await ask("B7 TransactionStorage.store move log", storeCall(api, log));

  if (sendWhat === "store") await real("B7 TransactionStorage.store move log", storeCall(api, log));
  await ask("B6 Scheduler.scheduleAfter", api.tx.scheduler.scheduleAfter(10, null, 0, remarkCall(api, "x").method));
  await ask("B6 Scheduler.schedule", api.tx.scheduler.schedule(sch.when, null, 0, remarkCall(api, "x").method));

  // B8: can our wallets use Oracle or Lottery? Ask the node, and read who is allowed.
  await ask("B8 Oracle.feedValues", api.tx.oracle.feedValues([[api.createType("Bytes", "0x01"), 1]] as never));
  await ask("B8 Lottery.startLottery", api.tx.lottery.startLottery(1, 10, 10, true));
  const members = await api.query.oracle.hasDispatched?.();
  console.log("B8 Oracle raw values stored:", (await api.query.oracle.rawValues.entries()).length, "| lottery state:", JSON.stringify((await api.query.lottery.lottery()).toJSON()), "| hasDispatched read:", members ? "ok" : "n/a");
  process.exit(0);
}
main().catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
