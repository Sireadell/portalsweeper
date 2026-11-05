// Puts Portals up for sale from the treasury wallet and lets Player B buy one, both sent from normal 0x wallets
// through the runtime pallets address (revive.ethSubstrateCall).
// Look first (changes nothing):   npx tsx scripts/portal-sale.ts 398 399 400
// Put them on sale:                npx tsx scripts/portal-sale.ts 398 399 400 --list --yes
// Player B buys the first one:     npx tsx scripts/portal-sale.ts 398 399 400 --buy --yes
// Keys come from .env.local (TREASURY_PRIVATE_KEY, PLAYER_B_PRIVATE_KEY) and are never printed.
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
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
const key = (env: string) => { const raw = process.env[env]; if (!raw) throw new Error(`${env} is not set.`); return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex); };

async function main() {
  const { portaldot: chain } = await import("../lib/portaldot");
  const { getApi, portalOwners, mappedAccount, walletOf } = await import("../lib/native");
  const { ethCallData, PALLETS_ADDRESS } = await import("../lib/swap");
  const { portalPricePlanck, shardPoolReserves, setPriceCall, buyItemCall, portalsForSale, planckToTpot } = await import("../lib/portalSale");
  const { shardAssetId } = await import("../lib/shardToken");
  const api = await getApi();
  const pub = createPublicClient({ chain, transport: http() });
  const [rn, rs] = await shardPoolReserves(api, shardAssetId());
  const price = portalPricePlanck(rn, rs);
  console.log(`Pool holds ${planckToTpot(rn)} tPOT and ${rs} SHARD. Price of a Portal: ${planckToTpot(price)} tPOT (${price} smallest units).`);
  const owners = await portalOwners(ids);
  const onSale = await portalsForSale(api, ids);
  for (const id of ids) console.log(`Portal #${id}: owner ${owners.get(id) ?? "none"} wallet ${walletOf(owners.get(id) ?? "") ?? "?"}, for sale at ${onSale.find((s) => s.id === id)?.price ?? "no"}`);

  const send = async (who: ReturnType<typeof key>, call: Parameters<typeof ethCallData>[0], label: string) => {
    const data = ethCallData(call);
    const gas = await pub.estimateGas({ account: who.address, to: PALLETS_ADDRESS, data, value: 0n });
    console.log(`${label}: node accepted, gas ${gas}`);
    if (!yes) return null;
    const wallet = createWalletClient({ account: who, chain, transport: http() });
    const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data, value: 0n });
    const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    console.log(`  tx ${hash} block ${rcpt.blockNumber} status ${rcpt.status}`);
    if (rcpt.status !== "success") throw new Error("The transaction failed.");
    return { hash, block: Number(rcpt.blockNumber) };
  };

  if (args.includes("--list")) {
    const t = key("TREASURY_PRIVATE_KEY");
    console.log(`Treasury ${t.address} holds ${Number(await pub.getBalance({ address: t.address })) / 1e18} tPOT`);
    for (const id of ids) await send(t, setPriceCall(api, id, price), `setPrice #${id}`);
  }
  if (args.includes("--buy")) {
    const b = key("PLAYER_B_PRIVATE_KEY");
    const id = ids[0];
    const before = await pub.getBalance({ address: b.address });
    console.log(`Player B ${b.address} holds ${Number(before) / 1e18} tPOT`);
    const r = await send(b, buyItemCall(api, id, price), `buyItem #${id}`);
    if (r) {
      const owner = (await portalOwners([id])).get(id);
      const after = await pub.getBalance({ address: b.address });
      console.log(`Owner read back: ${owner}; expected ${mappedAccount(b.address)}; match ${owner === mappedAccount(b.address)}; Player B paid ${Number(before - after) / 1e18} tPOT`);
      console.log(`PROOF ${JSON.stringify(r)}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
