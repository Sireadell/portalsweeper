import { describe, it, expect } from "vitest";
import { firstBlockOfEpoch, usesChainRandom } from "./chainRandom";
import { generateBoard } from "./engine";
import { fakePortal } from "./engine.test";

// 100 blocks per epoch starting at block 1000, epoch 10.
const epochAt = async (n: number) => 10 + Math.floor((n - 1000) / 100);

describe("firstBlockOfEpoch", () => {
  it("finds the first block of the target epoch", async () => {
    expect(await firstBlockOfEpoch(epochAt, 1050, 1900, 13)).toBe(1300);
    expect(await firstBlockOfEpoch(epochAt, 1050, 1900, 11)).toBe(1100);
  });
  it("gives null while the target epoch has not started", async () => {
    expect(await firstBlockOfEpoch(epochAt, 1050, 1299, 13)).toBeNull();
  });
  it("gives the start block when it is already in the target epoch", async () => {
    expect(await firstBlockOfEpoch(epochAt, 1300, 1350, 13)).toBe(1300);
  });
});

describe("usesChainRandom", () => {
  it("is off without RANDOM_FROM and on from that day", () => {
    expect(usesChainRandom("2026-11-07", undefined)).toBe(false);
    expect(usesChainRandom("2026-11-06", "2026-11-07")).toBe(false);
    expect(usesChainRandom("2026-11-07", "2026-11-07")).toBe(true);
    expect(usesChainRandom("2026-11-08", "nope")).toBe(false);
  });
});

describe("board seed with the chain number", () => {
  const meta = fakePortal(3, "Common");
  const rnd = "0x" + "22".repeat(32);
  it("leaves the old board unchanged when no number is given", () => {
    expect(JSON.stringify(generateBoard(meta, "2026-11-07", "s"))).toBe(JSON.stringify(generateBoard(meta, "2026-11-07", "s", undefined)));
  });
  it("changes the board with the number, and the same number gives the same board", () => {
    const base = JSON.stringify(generateBoard(meta, "2026-11-07", "s").cells);
    const a = JSON.stringify(generateBoard(meta, "2026-11-07", "s", rnd).cells);
    expect(a).not.toBe(base);
    expect(a).toBe(JSON.stringify(generateBoard(meta, "2026-11-07", "s", rnd).cells));
    expect(JSON.stringify(generateBoard(meta, "2026-11-07", "s", "0x" + "33".repeat(32)).cells)).not.toBe(a);
  });
  it("mixes a wallet into the seed, stable per wallet, and leaves the no-wallet board alone", () => {
    const w1 = "0x" + "a1".repeat(20);
    const w2 = "0x" + "b2".repeat(20);
    const plain = JSON.stringify(generateBoard(meta, "2026-11-07", "s", rnd).cells);
    const one = JSON.stringify(generateBoard(meta, "2026-11-07", "s", rnd, w1).cells);
    expect(one).not.toBe(plain);
    expect(one).toBe(JSON.stringify(generateBoard(meta, "2026-11-07", "s", rnd, w1).cells));
    expect(JSON.stringify(generateBoard(meta, "2026-11-07", "s", rnd, w2).cells)).not.toBe(one);
    expect(JSON.stringify(generateBoard(meta, "2026-11-07", "s", undefined, w1).cells)).not.toBe(JSON.stringify(generateBoard(meta, "2026-11-07", "s", undefined, w2).cells));
    expect(() => generateBoard(meta, "2026-11-07", "s", rnd, "nope")).toThrow();
  });
});
