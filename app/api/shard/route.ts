import { NextResponse } from "next/server";
import { getKv } from "@/lib/shardKv";
import { SHARD_PRIZES, SHARD_SUPPLY_CAP, burnedKey, recentAwards } from "@/lib/shardAward";
import { REDEEMS_PER_DAY, REDEEM_PRICE, redeemLogKey, type RedeemRecord } from "@/lib/redeem";
import { mintedPortalIds, shardBalanceOf, shardErc20, shardSupply } from "@/lib/shardChain";
import { shardAssetId } from "@/lib/shardToken";
import { utcToday } from "@/lib/salt";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function safe<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

// Everything the SHARD page shows: the token, prizes, recent awards, which Portals are taken, and (with ?address=0x..) that wallet's balance.
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  const kv = getKv();
  const wallet = address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null;
  const [balance, supply, minted, awards, burned, today, log] = await Promise.all([
    wallet ? safe(() => shardBalanceOf(wallet), null) : Promise.resolve(null),
    safe(() => shardSupply(), null),
    safe(() => mintedPortalIds(), null),
    safe(() => recentAwards(kv, 7), []),
    safe(async () => Number((await kv.get(burnedKey)) ?? 0), 0),
    safe(async () => Number((await kv.get(`redeem:day:${utcToday()}`)) ?? 0), 0),
    safe(async () => JSON.parse((await kv.get(redeemLogKey)) ?? "[]") as RedeemRecord[], []),
  ]);
  return NextResponse.json(
    {
      assetId: shardAssetId(),
      erc20: shardErc20(),
      price: REDEEM_PRICE,
      prizes: SHARD_PRIZES,
      supplyCap: SHARD_SUPPLY_CAP,
      supply,
      burned,
      balance,
      redeemsToday: today,
      redeemsPerDay: REDEEMS_PER_DAY,
      minted,
      awards: awards.map((a) => ({ date: a.date, status: a.status, txHash: a.txHash, block: a.block, rows: a.rows, held: a.held, portalSkipped: a.portalSkipped })),
      redeems: log.slice(-5).reverse(),
    },
    { headers: NO_STORE },
  );
}
