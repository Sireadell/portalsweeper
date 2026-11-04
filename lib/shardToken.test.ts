import { describe, expect, it } from "vitest";
import { assetErc20Address, DEFAULT_SHARD_ASSET_ID } from "./shardToken";

describe("assetErc20Address", () => {
  it("matches the address read live for asset 7777 (pUSD)", () => {
    expect(assetErc20Address(7777)).toBe("0x00001e6100000000000000000000000000010000");
  });
  it("is 20 bytes for any asset id", () => {
    for (const id of [0, 1, DEFAULT_SHARD_ASSET_ID, 0xffffffff]) expect(assetErc20Address(id)).toMatch(/^0x[0-9a-f]{40}$/);
  });
  it("rejects ids that do not fit in 4 bytes", () => {
    expect(() => assetErc20Address(-1)).toThrow();
    expect(() => assetErc20Address(0x100000000)).toThrow();
    expect(() => assetErc20Address(1.5)).toThrow();
  });
});
