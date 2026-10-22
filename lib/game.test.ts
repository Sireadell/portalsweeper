import { describe, expect, it } from "vitest";
import { generateBoard, neighbors } from "./engine";
import { applyFirstClick, chord, flag, newGame, replay, reveal, type GameState, type Move } from "./game";
import { fakePot, randomPot } from "./engine.test";

const D = "2026-10-20";

describe("first click safety", () => {
  it("is always safe and opens an area on 200 boards", () => {
    for (let id = 1; id <= 200; id++) {
      const b = generateBoard(randomPot(id), D, `s${id}`);
      const click = (id * 7) % (b.cols * b.rows);
      if (click === b.freeFlag) continue;
      const s = reveal(newGame(b), click);
      expect(s.status === "playing" || s.status === "won").toBe(true);
      expect(s.board.cells[click].mine).toBe(false);
      expect(s.revealed[click]).toBe(true);
      expect(s.board.cells.filter((c) => c.mine).length).toBe(b.mines);
      if (b.freeFlag !== undefined) expect(s.board.cells[b.freeFlag].mine).toBe(true);
      if (b.freePeek !== undefined) {
        expect(s.board.cells[b.freePeek].mine).toBe(false);
        expect(s.revealed[b.freePeek]).toBe(true);
      }
    }
  });
  it("relocation is deterministic", () => {
    const b = generateBoard(fakePot(4, "Epic"), D, "s");
    const a1 = JSON.stringify(applyFirstClick(b, 20).cells);
    const a2 = JSON.stringify(applyFirstClick(b, 20).cells);
    expect(a1).toBe(a2);
  });
  it("clicking right on a mine still lands safe", () => {
    const b = generateBoard(fakePot(8, "Common"), D, "s");
    const m = b.cells.findIndex((c) => c.mine);
    const s = reveal(newGame(b), m);
    expect(s.status).not.toBe("lost");
  });
});

describe("play rules", () => {
  it("flag toggles, flagged cells cannot be revealed", () => {
    const b = generateBoard(fakePot(2, "Common"), D, "s");
    let s = flag(newGame(b), 0);
    expect(s.flagged[0]).toBe(true);
    s = reveal(s, 0);
    expect(s.revealed[0]).toBe(false);
    s = flag(s, 0);
    expect(s.flagged[0]).toBe(false);
  });
  it("Accessory mine starts flagged and stays flagged", () => {
    const b = generateBoard(fakePot(2, "Common", undefined, undefined, "Cowrie"), D, "s");
    let s = newGame(b);
    expect(s.flagged[b.freeFlag as number]).toBe(true);
    s = flag(s, b.freeFlag as number);
    expect(s.flagged[b.freeFlag as number]).toBe(true);
  });
  it("flood fill opens neighbours of a zero", () => {
    const b = generateBoard(fakePot(2, "Epic"), D, "s");
    const s = reveal(newGame(b), 0);
    const open = s.revealed.filter(Boolean).length;
    expect(open).toBeGreaterThan(1);
  });
  it("loses on a mine without a shield, ignores moves afterwards", () => {
    const b = generateBoard(fakePot(3, "Common"), D, "s");
    let s = reveal(newGame(b), 0);
    const mine = s.board.cells.findIndex((c, i) => c.mine && !s.revealed[i]);
    s = reveal(s, mine);
    expect(s.status).toBe("lost");
    expect(s.hit).toBe(mine);
    expect(reveal(s, 1)).toBe(s);
  });
  it("shield survives exactly one mine", () => {
    const b = generateBoard(fakePot(3, "Common", undefined, "Iron Lid"), D, "s");
    expect(b.shields).toBe(1);
    let s = reveal(newGame(b), 0);
    const mines = s.board.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0 && !s.revealed[i]);
    s = reveal(s, mines[0]);
    expect(s.status).toBe("playing");
    expect(s.shieldsLeft).toBe(0);
    expect(s.shielded).toEqual([mines[0]]);
    s = reveal(s, mines[1]);
    expect(s.status).toBe("lost");
  });
  it("chord opens neighbours when flags match", () => {
    const b = generateBoard(fakePot(12, "Epic"), D, "s");
    let s = reveal(newGame(b), 0);
    // find a revealed number with hidden neighbours, flag its mines, chord it
    for (let i = 0; i < s.board.cells.length; i++) {
      const c = s.board.cells[i];
      if (!s.revealed[i] || c.mine || c.adj === 0) continue;
      const ns = neighbors(i, s.board.cols, s.board.rows);
      if (!ns.some((n) => !s.revealed[n] && !s.board.cells[n].mine)) continue;
      for (const n of ns) if (s.board.cells[n].mine && !s.flagged[n]) s = flag(s, n);
      const before = s.revealed.filter(Boolean).length;
      const after = chord(s, i);
      expect(after.revealed.filter(Boolean).length).toBeGreaterThan(before);
      expect(after.status).not.toBe("lost");
      return;
    }
    throw new Error("no chord candidate found");
  });
  it("chord does nothing with the wrong flag count", () => {
    const b = generateBoard(fakePot(12, "Epic"), D, "s");
    const s = reveal(newGame(b), 0);
    const i = s.board.cells.findIndex((c, k) => s.revealed[k] && !c.mine && c.adj > 0);
    expect(chord(s, i)).toBe(s);
  });
});

// A simple solver driver: reveals every safe cell using true board knowledge.
function playToWin(s: GameState): GameState {
  for (let i = 0; i < s.board.cells.length && s.status !== "won"; i++) {
    if (!s.board.cells[i].mine && !s.revealed[i]) s = reveal(s, i);
  }
  return s;
}

describe("win detection and replay", () => {
  it("wins when all safe cells are open", () => {
    const b = generateBoard(fakePot(21, "Uncommon"), D, "s");
    const s = playToWin(reveal(newGame(b), 0));
    expect(s.status).toBe("won");
  });
  it("replay equals the live result for a win, a loss and mixed moves", () => {
    for (let id = 1; id <= 40; id++) {
      const b = generateBoard(randomPot(id), D, `s${id}`);
      let live = newGame(b);
      // scripted pseudo random moves
      for (let k = 0; k < 60 && live.status !== "won" && live.status !== "lost"; k++) {
        const idx = (id * 31 + k * 17) % live.board.cells.length;
        const r = (id + k) % 3;
        live = r === 0 ? flag(live, idx) : r === 1 ? chord(live, idx) : reveal(live, idx);
      }
      const re = replay(b, live.moves);
      expect(re.status).toBe(live.status);
      expect(re.revealed).toEqual(live.revealed);
      expect(re.flagged).toEqual(live.flagged);
      expect(re.board.cells).toEqual(live.board.cells);
      expect(re.shielded).toEqual(live.shielded);
    }
    const b = generateBoard(fakePot(21, "Uncommon"), D, "s");
    const won = playToWin(reveal(newGame(b), 0));
    const moves: Move[] = won.moves;
    expect(replay(b, moves).status).toBe("won");
    expect(JSON.parse(JSON.stringify(moves))).toEqual(moves);
  });
});
