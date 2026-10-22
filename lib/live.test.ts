import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import { generateBoard } from "./engine";
import { dailyMove, dailyState, maskBoard, parseMove, replayLog } from "./live";
import type { PortalMeta } from "./types";

const meta: PortalMeta = { id: 7, name: "Portal #7", image: "", traits: [{ trait_type: "Tier", value: "Common" }] };
const board = generateBoard(meta, "2026-10-20", "0xsalt");
const store = () => new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "live-")), "r.json"));

describe("server-checked daily boards", () => {
  it("hides every covered cell", () => {
    const m = maskBoard(board, board.cells.map((_, i) => i === 0));
    expect(m.cells[0]).toEqual(board.cells[0]);
    expect(m.cells.slice(1).every((c) => !c.mine && c.adj === 0)).toBe(true);
  });

  it("reads only the three move kinds", () => {
    expect(parseMove({ action: "reveal", idx: 3 })).toEqual({ action: "reveal", idx: 3 });
    expect(parseMove({ action: "boom", idx: 3 })).toBeNull();
    expect(parseMove({ action: "flag", idx: 1.5 })).toBeNull();
    expect(parseMove(null)).toBeNull();
  });

  it("times a game on the server, records it once and ignores moves after the end", async () => {
    const s = store();
    let t = 1_000_000;
    const first = await dailyState(s, board, t);
    expect(first.board.cells.some((c) => c.mine)).toBe(false);
    let live = first;
    while (live.status !== "won") {
      const g = replayLog(board, await s.movesGet("day:2026-10-20:7"));
      const idx = g.board.cells.findIndex((c, i) => !c.mine && !g.revealed[i]);
      t += 2000;
      live = await dailyMove(s, board, { action: "reveal", idx }, t);
    }
    const rec = await s.getRecord(7);
    expect(rec).toMatchObject({ plays: 1, wins: 1 });
    expect(rec.bestSeconds).toBe(live.elapsed);
    const after = await dailyMove(s, board, { action: "reveal", idx: 0 }, t + 5000);
    expect(after.elapsed).toBe(live.elapsed);
    expect((await s.getRecord(7)).plays).toBe(1);
    // a refresh gets the finished board back, mines and all
    expect((await dailyState(s, board, t + 9000)).board.cells.some((c) => c.mine)).toBe(true);
  });
});
