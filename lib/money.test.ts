import { describe, expect, it } from "vitest";
import { modelRows } from "./moneyModel";
import { poolTotals } from "./moneyFacts";
import type { PoolEvent } from "./predictions";

const back = (n: number, wei: string, extra: object = {}) => ({ wallet: "0x" + n.toString(16).padStart(40, "0"), side: "creator" as const, amountWei: wei, txHash: "0x" + n, at: 1, ...extra });

describe("money model", () => {
  it("gives the example numbers from the written inputs", () => {
    const r = modelRows();
    expect(r.map((x) => x.line)).toEqual(["Portal sales", "Pool cut", "Sponsored day"]);
    expect(r[0].result).toContain("10,000 coins");
    expect(r[1].result).toContain("50 coins a week");
    expect(r[2].result).toContain("20 coins a week");
  });
  it("counts only ended pools and only backs that joined, and adds up the cut", () => {
    const recs: PoolEvent[] = [
      { id: "a", creator: "x", createdAt: 1, status: "settled", cutWei: "30000000000000000", backs: [back(1, "100"), back(2, "200", { refundOnly: "late" })] },
      { id: "b", creator: "x", createdAt: 1, status: "refunded", backs: [back(3, "50")] },
      { id: "c", creator: "x", createdAt: 1, status: "open", backs: [back(4, "999")] },
    ];
    expect(poolTotals(recs)).toEqual({ paid: 1, refunded: 1, throughWei: 150n, cutWei: 30000000000000000n });
  });
});
