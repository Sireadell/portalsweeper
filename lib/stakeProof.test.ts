import { describe, expect, it } from "vitest";
import { confirmSteps, stakeSteps } from "./stakeProof";

describe("stake run record", () => {
  it("lists every step in order, each with a hash and a block", () => {
    const steps = stakeSteps();
    expect(steps).toHaveLength(10);
    expect(steps.filter((s) => s.kind === "payout")).toHaveLength(1);
    expect(steps.filter((s) => s.kind === "refund")).toHaveLength(2);
    for (const s of steps) {
      expect(s.hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(s.block).toBeGreaterThan(0);
    }
    const blocks = steps.map((s) => s.block);
    expect([...blocks].sort((a, b) => a - b)).toEqual(blocks);
  });

  it("marks a step true only when its receipt says success", async () => {
    const steps = stakeSteps();
    let n = 0;
    const pub = { getTransactionReceipt: async () => { n++; if (n === 2) throw new Error("not found"); return { status: n === 3 ? "reverted" : "success" }; } } as never;
    const out = await confirmSteps(steps.slice(0, 4), pub);
    expect(out).toEqual([true, false, false, true]);
  });
});
