import { describe, expect, it } from "vitest";
import { cpuPercent, cpuTotalSeconds, cpuVerdict } from "./cpu";

describe("CPU opponent", () => {
  it("is off for solo play", () => {
    expect(cpuTotalSeconds("off", 54)).toBe(0);
    expect(cpuPercent("off", 54, 30)).toBe(0);
    expect(cpuVerdict("off", 54, true, 10)).toBeNull();
  });
  it("is faster at higher levels, and the same every time", () => {
    const [e, m, h] = (["easy", "medium", "hard"] as const).map((l) => cpuTotalSeconds(l, 54));
    expect(e).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(h);
    expect(cpuTotalSeconds("medium", 54)).toBe(m);
  });
  it("moves forward and finishes at 100", () => {
    const t = cpuTotalSeconds("medium", 54);
    let last = -1;
    for (let s = 0; s <= t; s += 2) { const p = cpuPercent("medium", 54, s); expect(p).toBeGreaterThanOrEqual(last); last = p; }
    expect(cpuPercent("medium", 54, t)).toBe(100);
    expect(cpuPercent("medium", 54, 0)).toBe(0);
  });
  it("decides the race", () => {
    const t = cpuTotalSeconds("hard", 54);
    expect(cpuVerdict("hard", 54, true, t - 5)).toEqual({ youWon: true, margin: 5 });
    expect(cpuVerdict("hard", 54, true, t + 4)).toEqual({ youWon: false, margin: 4 });
    expect(cpuVerdict("hard", 54, false, 3)?.youWon).toBe(false);
  });
});
