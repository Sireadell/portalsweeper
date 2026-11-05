// T2: can the escrow wallet pay several wallets plus a note in ONE chain action, through the runtime pallets address?
// Look first (changes nothing):  npx tsx scripts/test-pool-payout.ts
// Send it for real:              npx tsx scripts/test-pool-payout.ts --send [--tpot 0.01]
// Pays Player A and Player B the same small amount from the escrow wallet. Keys come from .env.local, never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const args = process.argv.slice(2);
const send = args.includes("--send");
const tpot = args.includes("--tpot") ? args[args.indexOf("--tpot") + 1] : "0.01";
const addr = (k: string | undefined, n: string) => {
  if (!k) throw new Error(`${n} is not set.`);
  return privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex).address.toLowerCase();
};

async function main() {
  const { portaldot } = await import("../lib/portaldot");
  const { parseTpot } = await import("../lib/stakes");
  const { getApi } = await import("../lib/native");
  const { PALLETS_ADDRESS } = await import("../lib/swap");
  const { poolBatchData, poolNote, portaldotPoolChain, escrowWalletAddress } = await import("../lib/poolPayout");
  const a = addr(process.env.PLAYER_A_PRIVATE_KEY, "PLAYER_A_PRIVATE_KEY");
  const b = addr(process.env.PLAYER_B_PRIVATE_KEY, "PLAYER_B_PRIVATE_KEY");
  const wei = parseTpot(tpot);
  const note = poolNote("0000000072a2", a);
  const payments = [{ to: a, wei }, { to: b, wei }];
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const escrow = escrowWalletAddress();
  const bal = async (x: string) => (await pub.getBalance({ address: x as Hex })).toString();
  console.log("escrow", escrow, "balance (wei)", await bal(escrow));
  console.log("A", a, await bal(a), "| B", b, await bal(b));
  const data = await poolBatchData(payments, note);
  try {
    const gas = await pub.estimateGas({ account: escrow as Hex, to: PALLETS_ADDRESS, data, value: 0n });
    console.log("DRY RUN: node accepted the batch, gas", gas.toString());
  } catch (e) {
    console.log("DRY RUN: node refused:", ((e as { details?: string }).details ?? (e as Error).message).slice(0, 300));
  }
  if (!send) {
    console.log("Nothing sent. Add --send to send it.");
    process.exit(0);
  }
  const r = await portaldotPoolChain().payBatch(payments, note);
  console.log("BATCH SENT. tx", r.txHash, "block", r.block);
  console.log("A", await bal(a), "| B", await bal(b));
  const api = await getApi();
  const at = await api.at(await api.rpc.chain.getBlockHash(r.block!));
  const events = (await at.query.system.events()) as unknown as { event: { section: string; method: string }; toHuman(): unknown }[];
  const mine = events.filter((e) => ["balances", "system", "utility", "revive"].includes(e.event.section)).map((e) => `${e.event.section}.${e.event.method} ${JSON.stringify(e.toHuman()).slice(0, 160)}`);
  console.log("events:\n  " + mine.join("\n  "));
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
