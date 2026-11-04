import { describe, it, expect } from "vitest";
import { quoteOut, minOut, parseTpot14, feeDenominator } from "./swap-pool-math";

describe("swap pool maths", () => {
  it("quotes less than the spot price because of the fee and the price move", () => {
    const out = quoteOut(1_000n, 100_000n, 100_000n);
    expect(out).toBeLessThan(1_000n);
    expect(out).toBe(987n); // 997000 * 100000 / (100000000 + 997000)
  });
  it("reads the fee out of a thousand or a million the same way", () => {
    expect(feeDenominator(3n)).toBe(1000n);
    expect(feeDenominator(3000n)).toBe(1_000_000n);
    expect(quoteOut(1000n, 100_000n, 100_000n, 3000n, 1_000_000n)).toBe(quoteOut(1000n, 100_000n, 100_000n));
  });
  it("gives nothing for an empty pool or zero input", () => {
    expect(quoteOut(0n, 10n, 10n)).toBe(0n);
    expect(quoteOut(5n, 0n, 10n)).toBe(0n);
  });
  it("never drains the pool", () => {
    expect(quoteOut(10n ** 30n, 1000n, 1000n)).toBeLessThan(1000n);
  });
  it("applies slippage", () => {
    expect(minOut(1000n, 5n)).toBe(950n);
    expect(() => minOut(1n, 101n)).toThrow();
  });
  it("parses tPOT with 14 decimals", () => {
    expect(parseTpot14("1")).toBe(10n ** 14n);
    expect(parseTpot14("0.5")).toBe(5n * 10n ** 13n);
    expect(() => parseTpot14("1.123456789012345")).toThrow();
  });
});
