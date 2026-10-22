import { describe, expect, it } from "vitest";
import { applyResult, EMPTY_STATS, isPracticeSalt, newPracticeSalt, nextPotId, parsePotId, randomPotId, tilesForBoard } from "./practice";
import { POT_SUPPLY } from "./types";

describe("practice salt", () => {
  it("is fresh each time and well formed", () => {
    const set = new Set(Array.from({ length: 200 }, newPracticeSalt));
    expect(set.size).toBe(200);
    for (const s of set) expect(isPracticeSalt(s)).toBe(true);
  });
  it("can never look like a daily salt", () => {
    expect(isPracticeSalt("0x" + "ab".repeat(32))).toBe(false);
    expect(newPracticeSalt().startsWith("0x")).toBe(false);
  });
});

describe("pot picking", () => {
  it("stays in range and never repeats the current Pot", () => {
    expect(randomPotId(() => 0)).toBe(1);
    expect(randomPotId(() => 0.9999999)).toBe(POT_SUPPLY);
    expect(nextPotId(1, () => 0)).toBe(2);
    expect(nextPotId(POT_SUPPLY, () => 0.9999999)).toBe(1);
  });
  it("parses ids", () => {
    expect(parsePotId("420")).toBe(420);
    expect(parsePotId("0")).toBeNull();
    expect(parsePotId("1970")).toBeNull();
    expect(parsePotId("x")).toBeNull();
  });
});

describe("chain score", () => {
  it("grows on wins and resets the streak on a loss, keeping best and tiles", () => {
    let s = applyResult(EMPTY_STATS, true, 54);
    s = applyResult(s, true, 30);
    expect(s).toEqual({ streak: 2, best: 2, tiles: 84, boards: 2 });
    s = applyResult(s, false, 99);
    expect(s).toEqual({ streak: 0, best: 2, tiles: 84, boards: 3 });
  });
  it("counts safe tiles", () => {
    expect(tilesForBoard(8, 8, 10)).toBe(54);
  });
});
