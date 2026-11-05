import { afterEach, describe, expect, it } from "vitest";
import { canPayInShard, feeAssetOption, shardFeesOn } from "./shardFee";

describe("paying a fee in SHARD", () => {
  afterEach(() => { delete process.env.SHARD_FEES; });

  it("is off unless SHARD_FEES=1", () => {
    expect(shardFeesOn()).toBe(false);
    process.env.SHARD_FEES = "1";
    expect(shardFeesOn()).toBe(true);
    process.env.SHARD_FEES = "true";
    expect(shardFeesOn()).toBe(false);
  });

  it("builds the option the chain accepts for SHARD (asset 5555)", () => {
    expect(feeAssetOption(5555)).toEqual({ assetId: { WithId: 5555 } });
    expect(() => feeAssetOption(-1)).toThrow();
    expect(() => feeAssetOption(1.5)).toThrow();
  });

  it("says whether the SHARD balance covers the quote", () => {
    const q = { feeTpotPlanck: "1", feeShard: 2, assetId: 5555 };
    expect(canPayInShard(2, q)).toBe(true);
    expect(canPayInShard(1, q)).toBe(false);
  });
});
