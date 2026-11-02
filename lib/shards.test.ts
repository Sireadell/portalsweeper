import { describe, expect, it } from "vitest";
import { emptyShards, isHardClear, recordClear, setComplete, shardCount, weekdayOf } from "./shards";

const clear = (date: string, o: Partial<Parameters<typeof recordClear>[1]> = {}) =>
  ({ date, tokenId: 9, won: true, ranked: true, tier: "Common", twist: "classic" as const, ...o });

describe("weekdayOf", () => {
  it("reads Monday as 0 and Sunday as 6", () => {
    expect(weekdayOf("2026-11-02")).toBe(0); // Monday
    expect(weekdayOf("2026-11-03")).toBe(1);
    expect(weekdayOf("2026-11-08")).toBe(6); // Sunday
  });
});

describe("recordClear", () => {
  it("gives a weekday shard for a ranked win", () => {
    const r = recordClear(emptyShards(), clear("2026-11-03"));
    expect(r.earned).toBe(1);
    expect(shardCount(r.state)).toBe(1);
  });
  it("gives nothing for a loss or an unranked game", () => {
    expect(recordClear(emptyShards(), clear("2026-11-03", { won: false })).earned).toBeNull();
    expect(recordClear(emptyShards(), clear("2026-11-03", { ranked: false })).earned).toBeNull();
  });
  it("gives only one shard per weekday", () => {
    const a = recordClear(emptyShards(), clear("2026-11-03"));
    const b = recordClear(a.state, clear("2026-11-10"));
    expect(b.earned).toBeNull();
    expect(shardCount(b.state)).toBe(1);
  });
  it("withholds the weekend shards from an easy clear and says why", () => {
    const r = recordClear(emptyShards(), clear("2026-11-07")); // Saturday
    expect(r.earned).toBeNull();
    expect(r.blockedHard).toBe(true);
  });
  it("gives a weekend shard for a hard clear: bigger Portal, twist or friend win", () => {
    expect(recordClear(emptyShards(), clear("2026-11-07", { tier: "Epic" })).earned).toBe(5);
    expect(recordClear(emptyShards(), clear("2026-11-08", { twist: "conductor" })).earned).toBe(6);
    expect(recordClear(emptyShards(), clear("2026-11-08", { friendWin: true })).earned).toBe(6);
  });
  it("lets a missed weekday be made up the next week and completes the set", () => {
    let s = emptyShards();
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) s = recordClear(s, clear(d)).state;
    s = recordClear(s, clear("2026-11-14", { tier: "Rare" })).state; // next Saturday
    expect(setComplete(s)).toBe(false);
    s = recordClear(s, clear("2026-11-15", { twist: "street" })).state; // next Sunday
    expect(setComplete(s)).toBe(true);
  });
});

describe("isHardClear", () => {
  it("is false for a Common Portal in classic", () => {
    expect(isHardClear({ tier: "Common", twist: "classic" })).toBe(false);
  });
});
