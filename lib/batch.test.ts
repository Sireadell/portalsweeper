import { describe, it, expect } from "vitest";
import { awardCalls, awardBatchTx, awardNote, type BatchApi } from "./batch";

const log: string[] = [];
const api: BatchApi = {
  tx: {
    nfts: {
      mint: (c, id, to) => (log.push("mint"), { m: `mint ${c} ${id} ${to}` }),
      setAttribute: (_c, _id, _ns, k) => (log.push(`attr:${k}`), { m: `attr ${k}` }),
    },
    assets: { mint: (id, to, n) => (log.push("shard"), { m: `shard ${id} ${to} ${n}` }) },
    system: { remarkWithEvent: (r) => (log.push("note"), { m: r }) },
    utility: { batchAll: (calls) => ({ batch: calls }) },
  },
};
const base = { collection: 5, portal: 7, recipient: "5abc", attributes: [{ key: "name", value: "x" }, { key: "traits", value: "a:b" }], shardAssetId: 5555, shardAmount: 3n, note: "n" };

describe("award batch", () => {
  it("orders mint, attributes, shard, note", () => {
    log.length = 0;
    awardCalls(api, base);
    expect(log).toEqual(["mint", "attr:name", "attr:traits", "shard", "note"]);
  });
  it("leaves the shard step out at zero", () => {
    log.length = 0;
    awardCalls(api, { ...base, shardAmount: 0n });
    expect(log).not.toContain("shard");
  });
  it("wraps everything in one batchAll", () => {
    expect((awardBatchTx(api, base) as { batch: unknown[] }).batch).toHaveLength(5);
  });
  it("rejects a bad portal and a bad date", () => {
    expect(() => awardCalls(api, { ...base, portal: 501 })).toThrow();
    expect(() => awardNote("5 Nov", 7, "0x1")).toThrow();
    expect(awardNote("2026-11-05", 7, "0x1")).toBe("portalsweeper award 2026-11-05 portal=7 winner=0x1");
  });
});
