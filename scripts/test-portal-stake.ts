// T1: Portal stake round trip on the real chain.
//   1. Player A moves Portal #N (default 104) to the escrow wallet's mapped account, with A's own 0x wallet.
//   2. The escrow wallet sends one batch (utility.batchAll) that moves it back plus a System.Remarked note.
// Look first:  npx tsx scripts/test-portal-stake.ts          Send for real:  npx tsx scripts/test-portal-stake.ts --send [portal]
// Keys come from .env.local and are never printed.
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
const send = process.argv.includes("--send");
const portal = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)) ?? 104);
const key = (n: string): Hex => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} is not set.`);
  return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
};

async function main() {
  const { portaldot: chain } = await import("../lib/portaldot");
  const { mappedAccount } = await import("../lib/native");
  const { PALLETS_ADDRESS, ethCallData } = await import("../lib/swap");
  const { lockCall, payoutBatch, portalPayoutNote } = await import("../lib/portalStake");
  const { PORTAL_COLLECTION_ID } = await import("../lib/types");
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
  const pub = createPublicClient({ chain, transport: http() });
  const a = privateKeyToAccount(key("PLAYER_A_PRIVATE_KEY"));
  const esc = privateKeyToAccount(key("ESCROW_PRIVATE_KEY"));
  const aNative = mappedAccount(a.address);
  const escNative = mappedAccount(esc.address);
  const ownerOf = async () => {
    const v = (await api.query.nfts.item(PORTAL_COLLECTION_ID, portal)).toJSON() as { owner?: string } | null;
    return v?.owner ?? null;
  };
  const eq = (x: string | null, y: string) => !!x && x === y;
  const norm = (s: string | null) => (s ? api.createType("AccountId32", s).toString() : null);
  const ss = (s: string) => api.createType("AccountId32", s).toString();
  console.log("collection", PORTAL_COLLECTION_ID, "portal", portal);
  console.log("player A", a.address, "escrow", esc.address);
  const before = norm(await ownerOf());
  console.log("owner now is player A:", eq(before, ss(aNative)), "| is escrow:", eq(before, ss(escNative)));

  const lock = lockCall(api, portal, escNative);
  const back = payoutBatch(api, [{ portal, to: aNative }], portalPayoutNote("T1", "cancel"));
  for (const [n, who, call] of [["lock", a.address, lock], ["return batch", esc.address, back]] as const) {
    try {
      const g = await pub.estimateGas({ account: who, to: PALLETS_ADDRESS, data: ethCallData(call), value: 0n });
      console.log(`DRY RUN ${n}: accepted, gas ${g}`);
    } catch (e) {
      console.log(`DRY RUN ${n}: refused:`, (e as Error).message.split("\n")[0].slice(0, 300));
    }
  }
  if (!send) return console.log("Nothing sent. Add --send.");
  if (!eq(before, ss(aNative))) throw new Error("Player A does not own this Portal now. Stopping.");

  const nativeEvents = async (block: number, re: RegExp) => {
    const at = await api.at(await api.rpc.chain.getBlockHash(block));
    return ((await at.query.system.events()) as unknown as { toHuman(): unknown }[]).map((e) => JSON.stringify(e.toHuman())).filter((s) => re.test(s));
  };

  const w1 = createWalletClient({ account: a, chain, transport: http() });
  const h1 = await w1.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(lock), value: 0n });
  const r1 = await pub.waitForTransactionReceipt({ hash: h1, timeout: 90_000 });
  console.log("LOCK tx", h1, "status", r1.status, "block", r1.blockNumber.toString());
  console.log("lock events:", await nativeEvents(Number(r1.blockNumber), /Nfts.*Transferred|"Transferred"/));
  const mid = norm(await ownerOf());
  console.log("owner after lock is escrow:", eq(mid, ss(escNative)));
  if (!eq(mid, ss(escNative))) throw new Error("Lock did not move the Portal.");

  const w2 = createWalletClient({ account: esc, chain, transport: http() });
  const h2 = await w2.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(back), value: 0n });
  const r2 = await pub.waitForTransactionReceipt({ hash: h2, timeout: 90_000 });
  console.log("RETURN batch tx", h2, "status", r2.status, "block", r2.blockNumber.toString());
  console.log("return events:", await nativeEvents(Number(r2.blockNumber), /Transferred|Remarked|BatchCompleted|BatchInterrupted/));
  const end = norm(await ownerOf());
  console.log("owner after return is player A:", eq(end, ss(aNative)));
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
