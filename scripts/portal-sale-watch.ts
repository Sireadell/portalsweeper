// Keeps the Portal shop price in step with the SHARD pool. Every few seconds it reads the pool, works out the price of a Portal,
// and if an unsold sale Portal is listed at a different price it lists it again at the new one (treasury wallet, setPrice).
// Look only (changes nothing):  npx tsx scripts/portal-sale-watch.ts
// Keep the price in step:       npx tsx scripts/portal-sale-watch.ts --yes
// Optional: --every=20 (seconds between looks). Keys come from .env.local and are never printed.
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
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const every = Number(args.find((a) => a.startsWith("--every="))?.split("=")[1] ?? 20) * 1000;

async function main() {
  const { portaldot: chain } = await import("../lib/portaldot");
  const { getApi } = await import("../lib/native");
  const { ethCallData, PALLETS_ADDRESS } = await import("../lib/swap");
  const { portalPricePlanck, shardPoolReserves, setPriceCall, portalsForSale, planckToTpot, SALE_PORTALS } = await import("../lib/portalSale");
  const { shardAssetId } = await import("../lib/shardToken");
  const raw = process.env.TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error("TREASURY_PRIVATE_KEY is not set.");
  const treasury = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  const api = await getApi();
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account: treasury, chain, transport: http() });
  const stamp = () => new Date().toISOString().slice(11, 19);

  for (;;) {
    try {
      const [rn, rs] = await shardPoolReserves(api, shardAssetId());
      const price = portalPricePlanck(rn, rs);
      const open = await portalsForSale(api, [...SALE_PORTALS]);
      const stale = open.filter((o) => o.price !== price);
      console.log(`${stamp()} pool ${planckToTpot(rn)} tPOT / ${rs} SHARD, price ${planckToTpot(price)}, on sale ${open.map((o) => `#${o.id}@${planckToTpot(o.price)}`).join(" ") || "none"}${stale.length ? `, ${stale.length} to relist` : ""}`);
      if (yes) {
        for (const o of stale) {
          const data = ethCallData(setPriceCall(api, o.id, price));
          const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data, value: 0n });
          const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
          console.log(`  relisted #${o.id} at ${planckToTpot(price)} tPOT: tx ${hash} block ${rcpt.blockNumber} ${rcpt.status}`);
        }
      }
    } catch (e) {
      console.error(`${stamp()} look failed:`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
main().catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
