// Paying a chain fee in SHARD instead of tPOT. This works for a native (Polkadot-style) account:
// the runtime swaps SHARD for tPOT through the SHARD/tPOT pool when the transaction carries the SHARD asset id.
// A normal 0x wallet cannot do it: an Ethereum transaction has no field for it. Off unless SHARD_FEES=1.
import type { ApiPromise } from "@polkadot/api";
import { shardAssetId } from "./shardToken";

export const shardFeesOn = (): boolean => process.env.SHARD_FEES === "1";

// The signing option a native wallet (or script) passes so the fee is taken from the SHARD balance.
export function feeAssetOption(assetId: number = shardAssetId()): { assetId: { WithId: number } } {
  if (!Number.isInteger(assetId) || assetId < 0 || assetId > 0xffffffff) throw new Error("Asset id must be a whole number that fits in 4 bytes.");
  return { assetId: { WithId: assetId } };
}

export type ShardFeeQuote = { feeTpotPlanck: string; feeShard: number; assetId: number };

// What a simple on-chain note costs for this account, in tPOT and in whole SHARD (rounded up, as the pool does).
export async function quoteShardFee(api: ApiPromise, address: string, assetId: number = shardAssetId()): Promise<ShardFeeQuote> {
  const info = await api.tx.system.remark("fee quote").paymentInfo(address);
  const fee = info.partialFee.toBigInt();
  const asset = (await (api.call as any).assetConversionApi.quotePriceTokensForExactTokens({ withId: assetId }, { native: null }, fee, true)) as { isSome: boolean; unwrap(): { toBigInt(): bigint } };
  if (!asset.isSome) throw new Error("The SHARD pool cannot quote this fee.");
  return { feeTpotPlanck: fee.toString(), feeShard: Number(asset.unwrap().toBigInt()), assetId };
}

// True when the account holds enough SHARD to cover the quote.
export const canPayInShard = (balance: number, quote: ShardFeeQuote): boolean => balance >= quote.feeShard;
