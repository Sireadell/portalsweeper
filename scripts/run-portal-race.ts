// Real-chain run of the Portal stake flow, using the same library code the race screens use:
// Player A and Player B each lock a Portal (their own wallet, Nfts.transfer to the escrow wallet), the server side
// checks the chain, Player A is named winner and the escrow wallet pays both Portals out in one batch.
// Look first: npx tsx scripts/run-portal-race.ts A_PORTAL B_PORTAL        Send for real: add --send
// Afterwards (with --send) Player A hands Player B's Portal back so both start where they were.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const [pa, pb] = [nums[0] ?? 104, nums[1] ?? 103];
const send = process.argv.includes("--send");
const key = (n: string): Hex => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} is not set.`);
  return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
};

async function main() {
  const { portaldot: chainDef } = await import("../lib/portaldot");
  const { getApi, mappedAccount, portalOwners } = await import("../lib/native");
  const { PALLETS_ADDRESS, ethCallData } = await import("../lib/swap");
  const { lockCall } = await import("../lib/portalStake");
  const { MemoryStakeStore, createStake, lockPortal, settleStake } = await import("../lib/stakes");
  const { portaldotStakeChain } = await import("../lib/stakeChain");
  const api = await getApi();
  const pub = createPublicClient({ chain: chainDef, transport: http() });
  const A = privateKeyToAccount(key("PLAYER_A_PRIVATE_KEY"));
  const B = privateKeyToAccount(key("PLAYER_B_PRIVATE_KEY"));
  const chain = portaldotStakeChain();
  const escrowNative = mappedAccount(chain.portalEscrowAddress!());
  const owners = async () => {
    const o = await portalOwners([pa, pb]);
    const who = (p: number) => (o.get(p) === mappedAccount(A.address) ? "Player A" : o.get(p) === mappedAccount(B.address) ? "Player B" : o.get(p) === escrowNative ? "escrow" : String(o.get(p)));
    return `#${pa}=${who(pa)} #${pb}=${who(pb)}`;
  };
  console.log("before:", await owners());
  if (!send) return console.log("Nothing sent. Add --send.");
  const deps = { store: new MemoryStakeStore(), chain };
  const id = "run" + Date.now().toString(16);
  await createStake(deps, id, { creator: A.address, asset: "portal" });
  const lock = async (acct: typeof A, portal: number) => {
    const w = createWalletClient({ account: acct, chain: chainDef, transport: http() });
    const hash = await w.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(lockCall(api, portal, escrowNative)), value: 0n });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    console.log(`LOCK Portal #${portal} from ${acct.address}: tx ${hash} block ${rc.blockNumber}`);
    await lockPortal(deps, id, acct.address, portal, hash);
  };
  await lock(A, pa);
  await lock(B, pb);
  console.log("after both locks:", await owners());
  const rec = await settleStake(deps, id, A.address);
  console.log(`PAYOUT batch (both Portals to Player A): tx ${rec.payoutTx} block ${rec.payoutBlock}`);
  console.log("after payout:", await owners());
  // Put things back: Player A hands Player B's Portal back with a plain transfer.
  const w = createWalletClient({ account: A, chain: chainDef, transport: http() });
  const back = await w.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(api.tx.nfts.transfer((await import("../lib/types")).PORTAL_COLLECTION_ID, pb, mappedAccount(B.address)) as never), value: 0n });
  const rb = await pub.waitForTransactionReceipt({ hash: back, timeout: 90_000 });
  console.log(`HAND BACK Portal #${pb} to Player B: tx ${back} block ${rb.blockNumber}`);
  console.log("end:", await owners());
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
