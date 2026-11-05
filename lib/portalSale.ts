// Selling a Portal for tPOT with Portaldot's built-in Nfts shop (nfts.setPrice, nfts.buyItem), no contract needed.
// The price follows the SHARD pool: a Portal costs what 100 SHARD cost at the pool's current price, rounded up.
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY } from "./types";

export const PORTAL_PRICE_SHARD = 100n; // the same 100 SHARD a redeem costs
export const PRICE_STEP = 10n ** 12n; // 0.01 tPOT on this chain (14 decimals), so the shown price is a round number

export const portalSaleOn = (): boolean => process.env.PORTAL_SALE === "1";

// Price in the chain's smallest tPOT unit for `shard` SHARD, from the pool's two balances.
// Rounded up to the next 0.01 tPOT, so it is never below the pool price.
export function portalPricePlanck(reserveNative: bigint, reserveShard: bigint, shard: bigint = PORTAL_PRICE_SHARD, step: bigint = PRICE_STEP): bigint {
  if (reserveNative <= 0n || reserveShard <= 0n) throw new Error("The SHARD pool has no balance, so there is no price.");
  if (shard <= 0n || step <= 0n) throw new Error("Bad price settings.");
  const exact = (reserveNative * shard + reserveShard - 1n) / reserveShard; // ceiling division
  return ((exact + step - 1n) / step) * step;
}

// The same price as a plain tPOT number for the page (one tPOT is 10^14 of the smallest unit).
export const planckToTpot = (planck: bigint): number => Number(planck) / 1e14;

type Call = SubmittableExtrinsic<"promise">;
function check(id: number, collection: number) {
  if (!Number.isInteger(id) || id < 1 || id > PORTAL_SUPPLY) throw new Error(`Portal number must be from 1 to ${PORTAL_SUPPLY}.`);
  if (!Number.isInteger(collection) || collection < 0) throw new Error("The Portal collection is not set.");
}

// The owner puts Portal `id` up for sale at `price`.
export function setPriceCall(api: ApiPromise, id: number, price: bigint, collection: number = PORTAL_COLLECTION_ID): Call {
  check(id, collection);
  if (price <= 0n) throw new Error("The price must be above zero.");
  return api.tx.nfts.setPrice(collection, id, price, null);
}

// A buyer pays at most `bidPrice`; the chain refuses if the asking price is higher.
export function buyItemCall(api: ApiPromise, id: number, bidPrice: bigint, collection: number = PORTAL_COLLECTION_ID): Call {
  check(id, collection);
  return api.tx.nfts.buyItem(collection, id, bidPrice);
}

// Pool balances (tPOT, SHARD) from the runtime.
export async function shardPoolReserves(api: ApiPromise, assetId: number): Promise<[bigint, bigint]> {
  const r = (await (api.call as any).assetConversionApi.getReserves({ native: null }, { withId: assetId })).toJSON() as [string | number, string | number] | null;
  if (!r) throw new Error("Could not read the SHARD pool.");
  return [BigInt(r[0]), BigInt(r[1])];
}

// Price and owner of each Portal that is for sale right now.
export async function portalsForSale(api: ApiPromise, ids: number[], collection: number = PORTAL_COLLECTION_ID): Promise<{ id: number; price: bigint }[]> {
  const rows = await api.query.nfts.itemPriceOf.multi(ids.map((id) => [collection, id]));
  const out: { id: number; price: bigint }[] = [];
  rows.forEach((r, i) => {
    const v = r.toJSON() as [number | string, string | null] | null;
    if (v) out.push({ id: ids[i], price: BigInt(v[0]) });
  });
  return out;
}

// The Portals kept for the sale (not in the 401 to 500 Shard reward range).
export const SALE_PORTALS: readonly number[] = [398, 399, 400];

export type SaleFacts = { priceTpot: number; forSale: number[]; sold: number[] } | null;

// What the page shows: the live price and which sale Portals are still on offer. Null when the chain cannot be read.
export async function saleFacts(): Promise<SaleFacts> {
  try {
    const { getApi } = await import("./native");
    const { shardAssetId } = await import("./shardToken");
    const api = await getApi();
    const [rn, rs] = await shardPoolReserves(api, shardAssetId());
    const open = await portalsForSale(api, [...SALE_PORTALS]);
    const forSale = open.map((o) => o.id);
    return { priceTpot: planckToTpot(portalPricePlanck(rn, rs)), forSale, sold: SALE_PORTALS.filter((id) => !forSale.includes(id)) };
  } catch {
    return null;
  }
}
