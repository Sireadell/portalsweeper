import { describe, expect, it } from "vitest";
import { generateBoard } from "./engine";
import * as G from "./game";
import { replayLog } from "./live";
import {
  DELAY_MS, MAX_LIVE, LINGER_MS, MemoryKv, endRankedBroadcast, heartbeat, listBroadcasts, registerRace, registerRanked,
  seatView, viewerCount, delayedLog,
} from "./broadcast";
import type { PortalMeta } from "./types";
import type { StoredMove } from "./records";

const meta: PortalMeta = { id: 5, name: "Portal #5", image: "x", traits: [{ trait_type: "Tier", value: "Common" }] };
const board = generateBoard(meta, "2026-11-05", "salt");
const mineIdx = board.cells.findIndex((c) => c.mine);

// A winning log: reveal every safe tile, one per second.
function winLog(t0: number): StoredMove[] {
  const log: StoredMove[] = [];
  let g = G.newGame(board);
  let t = t0;
  for (let i = 0; i < board.cells.length && g.status !== "won"; i++) {
    const real = replayLog(board, log);
    if (real.status === "won") break;
    const cur = replayLog(board, log);
    if (cur.revealed[i] || replayLog(board, [...log, { action: "reveal", idx: i, t }]).status === "lost") continue;
    log.push({ action: "reveal", idx: i, t });
    t += 1000;
    g = replayLog(board, log);
  }
  return log;
}

describe("seatView (15 second delay, no mines while running)", () => {
  const t0 = 1_000_000;
  const log = winLog(t0);
  const late = log.length ? log[log.length - 1].t : t0;

  it("shows nothing before the first move is 15 s old", () => {
    const v = seatView(board, log, t0 + DELAY_MS - 1);
    expect(v.revealed.some(Boolean)).toBe(false);
    expect(v.state).toBe("waiting");
  });

  it("shows only moves older than 15 s", () => {
    const v = seatView(board, log, t0 + DELAY_MS + 1);
    expect(v.revealed.filter(Boolean).length).toBeGreaterThan(0);
    expect(delayedLog(log, t0 + DELAY_MS + 1)).toHaveLength(1);
  });

  it("never holds a mine or a number on a closed tile while the game runs", () => {
    const now = t0 + DELAY_MS + 1500;
    const v = seatView(board, log, now);
    expect(v.state === "playing" || v.state === "won").toBe(true);
    if (v.state === "playing") {
      expect(v.mines).toBeUndefined();
      expect(v.hit).toBeUndefined();
      v.adj.forEach((a, i) => { if (!v.revealed[i]) expect(a).toBeNull(); });
      const json = JSON.stringify(v);
      expect(json).not.toContain('"mines"');
    }
  });

  it("gives the full board only after the end, and 15 s late", () => {
    const justAfter = seatView(board, log, late + 1000);
    expect(justAfter.state).not.toBe("won");
    expect(justAfter.mines).toBeUndefined();
    const after = seatView(board, log, late + DELAY_MS + 1);
    expect(after.state).toBe("won");
    expect(after.mines).toHaveLength(board.cells.length);
    expect(after.mines![mineIdx]).toBe(true);
  });

  it("a lost game shows its mine only after the delay", () => {
    const lose: StoredMove[] = [{ action: "reveal", idx: board.cells.findIndex((c) => !c.mine), t: t0 }];
    // find a log that loses: reveal a mine after a safe first move
    const withMine: StoredMove[] = [...lose, { action: "reveal", idx: mineIdx, t: t0 + 1000 }];
    const end = replayLog(board, withMine);
    if (end.status !== "lost") return; // the first click moved this mine, nothing to check
    expect(seatView(board, withMine, t0 + 1000 + DELAY_MS - 1).mines).toBeUndefined();
    const v = seatView(board, withMine, t0 + 1000 + DELAY_MS + 1);
    expect(v.state).toBe("lost");
    expect(v.mines).toBeDefined();
    expect(v.hit).toBe(mineIdx);
  });
});

describe("broadcast list", () => {
  const input = (w: string) => ({ wallet: w, date: "2026-11-05", tokenId: 5, tags: ["Common"], startedAt: 1000 });
  let n = 0;
  const code = () => (++n).toString(16).padStart(10, "0");

  it("same wallet and day returns the same broadcast", async () => {
    const k = new MemoryKv();
    const a = await registerRanked(k, input("0xaa"), 1000, code);
    const b = await registerRanked(k, input("0xaa"), 2000, code);
    expect(a.ok && b.ok && a.broadcast.code === b.broadcast.code).toBe(true);
    expect(await listBroadcasts(k, 3000)).toHaveLength(1);
  });

  it("stops at 50 live broadcasts", async () => {
    const k = new MemoryKv();
    for (let i = 0; i < MAX_LIVE; i++) expect((await registerRanked(k, input(`0x${i}`), 1000, code)).ok).toBe(true);
    const over = await registerRanked(k, input("0xzz"), 1000, code);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.status).toBe(429);
  });

  it("ends 10 minutes after the game ends", async () => {
    const k = new MemoryKv();
    await registerRanked(k, input("0xaa"), 1000, code);
    await endRankedBroadcast(k, "2026-11-05", "0xaa", 5000);
    expect(await listBroadcasts(k, 5000 + LINGER_MS - 1)).toHaveLength(1);
    expect(await listBroadcasts(k, 5000 + LINGER_MS + 1)).toHaveLength(0);
  });

  it("registers a race under its own id", async () => {
    const k = new MemoryKv();
    const r = await registerRace(k, { id: "abcdef012345", date: "2026-11-05", tokenId: 5, tags: ["Race"], startedAt: 1 }, 1);
    expect(r.ok && r.broadcast.code).toBe("abcdef012345");
  });
});

describe("viewers", () => {
  it("counts a viewer seen in the last 20 s, limits a heartbeat to one per 10 s", async () => {
    const k = new MemoryKv();
    const now = Date.now();
    expect((await heartbeat(k, "c1", "v1", now)).counted).toBe(true);
    expect((await heartbeat(k, "c1", "v1", now + 100)).counted).toBe(false);
    expect((await heartbeat(k, "c1", "v2", now + 200)).viewers).toBe(2);
    expect(await viewerCount(k, "c1", now + 19_000)).toBe(2);
    expect(await viewerCount(k, "c1", now + 21_000)).toBe(0);
  });
});
