import { describe, expect, it } from "vitest";
import { emptyRecord, type PortalRecord } from "./records";
import { cleanIds, longestRun, runDays, walletStreak } from "./streaks";

const rec = (tokenId: number, over: Partial<PortalRecord>): PortalRecord => ({ ...emptyRecord(tokenId), ...over });

describe("streaks", () => {
  it("expands a run across a month boundary", () => {
    expect(runDays(rec(1, { currentStreak: 3, lastDate: "2026-11-01" }))).toEqual(["2026-11-01", "2026-10-31", "2026-10-30"]);
    expect(runDays(rec(1, { currentStreak: 0, lastDate: "2026-11-01" }))).toEqual([]);
  });

  it("counts a streak that includes today", () => {
    const s = walletStreak([rec(1, { currentStreak: 3, longestStreak: 3, lastDate: "2026-10-20" })], "2026-10-20");
    expect(s).toEqual({ current: 3, best: 3, clearedToday: true, atRisk: false });
  });

  it("keeps the streak alive until the UTC day ends, then marks it at risk", () => {
    const r = rec(1, { currentStreak: 2, longestStreak: 2, lastDate: "2026-10-19" });
    expect(walletStreak([r], "2026-10-20")).toMatchObject({ current: 2, clearedToday: false, atRisk: true });
    // a full day missed: the streak is gone but the best stays
    expect(walletStreak([r], "2026-10-21")).toMatchObject({ current: 0, atRisk: false, best: 2 });
  });

  it("UTC day boundary: 23:59:59Z and 00:00:00Z fall on different days", () => {
    const before = new Date("2026-10-20T23:59:59Z").toISOString().slice(0, 10);
    const after = new Date("2026-10-21T00:00:00Z").toISOString().slice(0, 10);
    const r = rec(1, { currentStreak: 1, longestStreak: 1, lastDate: "2026-10-20" });
    expect(walletStreak([r], before)).toMatchObject({ current: 1, clearedToday: true });
    expect(walletStreak([r], after)).toMatchObject({ current: 1, clearedToday: false, atRisk: true });
  });

  it("joins different Portals on different days into one wallet streak", () => {
    const a = rec(1, { currentStreak: 1, longestStreak: 1, lastDate: "2026-10-19" });
    const b = rec(2, { currentStreak: 1, longestStreak: 1, lastDate: "2026-10-20" });
    expect(walletStreak([a, b], "2026-10-20")).toMatchObject({ current: 2, best: 2 });
  });

  it("two clears on one day count once", () => {
    const a = rec(1, { currentStreak: 1, longestStreak: 1, lastDate: "2026-10-20" });
    const b = rec(2, { currentStreak: 1, longestStreak: 1, lastDate: "2026-10-20" });
    expect(walletStreak([a, b], "2026-10-20").current).toBe(1);
  });

  it("uses extra win days such as Portal of the day", () => {
    expect(walletStreak([], "2026-10-20", ["2026-10-20", "2026-10-19"]).current).toBe(2);
  });

  it("empty wallet is zero", () => {
    expect(walletStreak([], "2026-10-20")).toEqual({ current: 0, best: 0, clearedToday: false, atRisk: false });
  });

  it("keeps an older best streak", () => {
    const r = rec(1, { currentStreak: 1, longestStreak: 9, lastDate: "2026-10-20" });
    expect(walletStreak([r], "2026-10-20")).toMatchObject({ current: 1, best: 9 });
  });

  it("longestRun and cleanIds", () => {
    expect(longestRun(new Set(["2026-10-01", "2026-10-02", "2026-10-04"]))).toBe(2);
    expect(cleanIds("1,2,2,0,1970,x,5")).toEqual([1, 2, 5]);
  });
});
