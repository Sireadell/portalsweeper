// Real-chain check of the pool cut: one batch pays the winner's backer, sends the cut to the treasury and writes the note.
// Look first (changes nothing):  npx tsx scripts/test-pool-cut.ts
// Send it for real:              npx tsx scripts/test-pool-cut.ts --send [--pot 0.02] [--bps 500]
// Player A plays the backer on the winning side, Player B stands in for the treasury (or TREASURY_ADDRESS if set).
// Keys come from .env.local, never printed.
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
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const addr = (k: string | undefined, n: string) => {
  if (!k) throw new Error(`${n} is not set.`);
  return privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex).address.toLowerCase();
};

async function main() {
  const { portaldot } = await import("../lib/portaldot");
  const { parseTpot, formatTpot } = await import("../lib/stakes");
  const { getApi } = await import("../lib/native");
  const { poolPayNote, portaldotPoolChain, escrowWalletAddress } = await import("../lib/poolPayout");
  const { cutOf, splitPot, treasuryAddress } = await import("../lib/predictions");
  const a = addr(process.env.PLAYER_A_PRIVATE_KEY, "PLAYER_A_PRIVATE_KEY");
  const treasury = process.env.TREASURY_ADDRESS ? treasuryAddress(escrowWalletAddress()) : addr(process.env.PLAYER_B_PRIVATE_KEY, "PLAYER_B_PRIVATE_KEY");
  const pot = parseTpot(opt("--pot", "0.02"));
  const bps = Number(opt("--bps", "500"));
  const cut = cutOf(pot, bps);
  const shares = splitPot([{ wallet: a, amountWei: pot }], pot, bps);
  const note = poolPayNote("0000000072a3", a, { potWei: pot, cutWei: cut, cutBps: bps, treasury, shares });
  const payments = [...shares, { to: treasury, wei: cut }];
  console.log("pot", formatTpot(pot), "cut", formatTpot(cut), "winner gets", formatTpot(shares[0].wei), "sum", formatTpot(payments.reduce((s, p) => s + p.wei, 0n)));
  console.log("note:", note);
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const bal = async (x: string) => (await pub.getBalance({ address: x as Hex })).toString();
  console.log("A before", await bal(a), "| treasury before", await bal(treasury));
  if (!send) {
    console.log("Nothing sent. Add --send to send it.");
    process.exit(0);
  }
  const r = await portaldotPoolChain().payBatch(payments, note);
  console.log("BATCH SENT. tx", r.txHash, "block", r.block);
  console.log("A after", await bal(a), "| treasury after", await bal(treasury));
  const api = await getApi();
  const at = await api.at(await api.rpc.chain.getBlockHash(r.block!));
  const events = (await at.query.system.events()) as unknown as { event: { section: string; method: string }; toHuman(): unknown }[];
  const mine = events.filter((e) => ["balances", "system", "utility"].includes(e.event.section)).map((e) => `${e.event.section}.${e.event.method} ${JSON.stringify(e.toHuman()).slice(0, 400)}`);
  console.log("events:\n  " + mine.join("\n  "));
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
