import { describe, expect, it } from "vitest";
import { planckToTpot, portalPricePlanck, PRICE_STEP } from "./portalSale";

describe("portalPricePlanck", () => {
  it("prices 100 SHARD at the pool ratio, rounded up to 0.01 tPOT", () => {
    // pool: 5.47258942439451 tPOT against 84 SHARD, so 100 SHARD is about 6.5150 tPOT
    const p = portalPricePlanck(547258942439451n, 84n);
    expect(p).toBe(652n * PRICE_STEP);
    expect(planckToTpot(p)).toBeCloseTo(6.52, 5);
  });
  it("is never below the exact pool price", () => {
    for (const [n, s] of [[547258942439451n, 84n], [10n ** 14n, 3n], [123456789012345n, 997n], [5n * 10n ** 14n, 90n]] as const) {
      const p = portalPricePlanck(n, s);
      expect(p * s).toBeGreaterThanOrEqual(n * 100n);
      expect(p % PRICE_STEP).toBe(0n);
    }
  });
  it("keeps an already round price", () => {
    expect(portalPricePlanck(6n * 10n ** 14n, 100n)).toBe(6n * 10n ** 14n);
  });
  it("refuses an empty pool", () => {
    expect(() => portalPricePlanck(0n, 84n)).toThrow();
    expect(() => portalPricePlanck(10n, 0n)).toThrow();
  });
});
