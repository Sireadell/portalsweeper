import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";

const fresh = () => new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "pot-")), "r.json"));
const win = (tokenId: number, date: string, seconds = 60) => ({ tokenId, date, won: true, seconds, moves: 10 });
const loss = (tokenId: number, date: string) => ({ tokenId, date, won: false, seconds: 5, moves: 2 });

describe("records", () => {
  it("counts plays, wins and best time", async () => {
    const s = fresh();
    await s.submit(win(1, "2026-10-20", 90));
    await s.submit(loss(1, "2026-10-21"));
    await s.submit(win(1, "2026-10-22", 45));
    const r = await s.getRecord(1);
    expect(r).toMatchObject({ plays: 3, wins: 2, bestSeconds: 45, lastDate: "2026-10-22" });
  });

  it("continues a streak on consecutive days", async () => {
    const s = fresh();
    await s.submit(win(7, "2026-10-30"));
    await s.submit(win(7, "2026-10-31"));
    const r = (await s.submit(win(7, "2026-11-01"))) as { record: { currentStreak: number; longestStreak: number } };
    expect(r.record.currentStreak).toBe(3);
    expect(r.record.longestStreak).toBe(3);
  });

  it("resets after a gap or a loss but keeps the longest", async () => {
    const s = fresh();
    await s.submit(win(2, "2026-10-20"));
    await s.submit(win(2, "2026-10-21"));
    await s.submit(win(2, "2026-10-23"));
    let r = await s.getRecord(2);
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(2);
    await s.submit(loss(2, "2026-10-24"));
    await s.submit(win(2, "2026-10-25"));
    r = await s.getRecord(2);
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(2);
  });

  it("allows only one result per token per day", async () => {
    const s = fresh();
    expect((await s.submit(win(3, "2026-10-20", 50))).ok).toBe(true);
    const second = await s.submit(win(3, "2026-10-20", 5));
    expect(second.ok).toBe(false);
    const r = await s.getRecord(3);
    expect(r.plays).toBe(1);
    expect(r.bestSeconds).toBe(50);
  });

  it("handles quick parallel writes without losing any", async () => {
    const s = fresh();
    await Promise.all([1, 2, 3, 4, 5].map((id) => s.submit(win(id, "2026-10-20"))));
    expect((await s.listRecords()).length).toBe(5);
  });

  it("keeps different tokens apart", async () => {
    const s = fresh();
    await s.submit(win(10, "2026-10-20"));
    expect((await s.getRecord(11)).plays).toBe(0);
  });
});
