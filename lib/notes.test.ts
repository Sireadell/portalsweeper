import { describe, expect, it } from "vitest";
import type { ApiPromise } from "@polkadot/api";
import { dayNote, parseNote, remarkCall } from "./remark";
import { blockAt, scheduleDayNote, scheduleId } from "./scheduler";
import { replayBytes, storeCall, STORAGE_MAX_BYTES } from "./storage";

const commit = "0x" + "ab".repeat(32);
const wallet = "0x" + "CD".repeat(20);
const got: unknown[][] = [];
const api = {
  tx: {
    remark: { store: (x: string) => ({ method: { tag: "remark", x }, x }) },
    scheduler: { scheduleNamed: (...a: unknown[]) => { got.push(a); return { a }; } },
    transactionStorage: { store: (x: string) => ({ x }) },
  },
} as unknown as ApiPromise;

describe("day note (Remark)", () => {
  it("writes one readable line and reads it back", () => {
    const t = dayNote({ date: "2026-11-06", commit, winner: { tokenId: 7, wallet } });
    expect(t).toBe(`portalsweeper/1 day=2026-11-06 fingerprint=${commit} portal=7 winner=${wallet.toLowerCase()}`);
    expect(parseNote(t)).toEqual({ date: "2026-11-06", commit, tokenId: 7, winner: wallet.toLowerCase() });
    expect(parseNote(dayNote({ date: "2026-11-06", commit }))).toEqual({ date: "2026-11-06", commit });
    expect(parseNote("hello")).toBeNull();
  });
  it("refuses a bad date or fingerprint", () => {
    expect(() => dayNote({ date: "6-11-2026", commit })).toThrow();
    expect(() => dayNote({ date: "2026-11-06", commit: "0x12" })).toThrow();
  });
  it("sends the note as hex bytes", () => {
    expect((remarkCall(api, "hi") as unknown as { x: string }).x).toBe("0x6869");
  });
});

describe("scheduler", () => {
  it("counts 6 second blocks to a moment and refuses the past", () => {
    expect(blockAt(1000, 0, 60_000)).toBe(1010);
    expect(blockAt(1000, 0, 60_001)).toBe(1011);
    expect(() => blockAt(1000, 5, 5)).toThrow();
  });
  it("schedules the day's note by name at the first block of the day", () => {
    got.length = 0;
    const head = Date.parse("2026-11-05T12:00:00Z");
    const { when } = scheduleDayNote(api, { date: "2026-11-06", commit, headBlock: 1_000, headTimeMs: head });
    expect(when).toBe(1_000 + (12 * 3600 * 1000) / 6000);
    expect(got[0][0]).toEqual(scheduleId("2026-11-06"));
    expect(got[0][1]).toBe(when);
    expect(scheduleId("2026-11-06")).not.toEqual(scheduleId("2026-11-07"));
  });
});

describe("replay storage", () => {
  it("stores a move log as hex and refuses empty or huge input", () => {
    expect(replayBytes([{ a: 1 }])).toBe('[{"a":1}]');
    expect((storeCall(api, [1]) as unknown as { x: string }).x).toBe("0x5b315d");
    expect(() => replayBytes(null)).toThrow();
    expect(() => replayBytes("x".repeat(STORAGE_MAX_BYTES))).toThrow(/too large/);
  });
});
