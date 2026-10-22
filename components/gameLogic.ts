// UI view over lib/game.ts. The real rules live in lib/game.ts (the same code the
// verifier replays); this file only adds a clock and flattens the state for drawing.
import type { Board, Cell } from "@/lib/types";
import * as G from "@/lib/game";

export type Status = "idle" | "playing" | "won" | "lost";

export type GameState = {
  g: G.GameState;
  cells: Cell[];
  revealed: boolean[];
  flagged: boolean[];
  status: Status;
  shields: number;
  shieldedAt: number[];
  hit: number | null;
  moves: number;
  startedAt: number | null;
  endedAt: number | null;
};

function view(g: G.GameState, startedAt: number | null, endedAt: number | null, now: number): GameState {
  const status: Status = g.status === "ready" ? "idle" : g.status;
  const over = status === "won" || status === "lost";
  const flagged = g.flagged.slice();
  // on a win every mine counts as marked
  if (status === "won") g.board.cells.forEach((c, i) => { if (c.mine) flagged[i] = true; });
  return {
    g,
    cells: g.board.cells,
    revealed: g.revealed,
    flagged,
    status,
    shields: g.shieldsLeft,
    shieldedAt: g.shielded,
    hit: g.hit ?? null,
    moves: g.moves.filter((m) => m.action !== "flag").length,
    startedAt: g.started ? (startedAt ?? now) : null,
    endedAt: over ? (endedAt ?? now) : null,
  };
}

export function initGame(b: Board): GameState {
  return view(G.newGame(b), null, null, Date.now());
}

function step(prev: GameState, next: G.GameState, now: number): GameState {
  if (next === prev.g) return prev;
  return view(next, prev.startedAt, prev.endedAt, now);
}

export function reveal(_b: Board, prev: GameState, i: number, now = Date.now()): GameState {
  return step(prev, G.reveal(prev.g, i), now);
}
export function flag(prev: GameState, i: number, now = Date.now()): GameState {
  return step(prev, G.flag(prev.g, i), now);
}
export function chord(_b: Board, prev: GameState, i: number, now = Date.now()): GameState {
  return step(prev, G.chord(prev.g, i), now);
}

export function minesLeft(b: Board, s: GameState): number {
  return b.mines - s.flagged.filter(Boolean).length;
}

export function seconds(s: GameState, now = Date.now()): number {
  if (s.startedAt === null) return 0;
  return Math.max(0, Math.floor(((s.endedAt ?? now) - s.startedAt) / 1000));
}
