// Live games on the server. Today's mines never leave the server: the browser sends one move at a
// time, the server replays the whole log on the real board and sends back only what is now open.
// The full board goes out once the game is over. Time is the server clock, first reveal to last move.
import * as G from "./game";
import type { Board, Cell } from "./types";
import type { RecordStore, StoredMove } from "./records";

export type LiveState = {
  board: Board; // hidden cells read { mine: false, adj: 0 } until the game is over
  revealed: boolean[];
  flagged: boolean[];
  shielded: number[];
  shieldsLeft: number;
  status: G.Status;
  started: boolean;
  hit?: number;
  moves: G.Move[];
  elapsed: number; // seconds on the server clock since the first reveal (final time once over)
};

const HIDDEN: Cell = { mine: false, adj: 0 };
const over = (s: G.GameState) => s.status === "won" || s.status === "lost";

export function maskBoard(board: Board, revealed: boolean[]): Board {
  return { ...board, cells: board.cells.map((c, i) => (revealed[i] ? c : HIDDEN)) };
}

function apply(s: G.GameState, m: G.Move): G.GameState {
  if (m.action === "reveal") return G.reveal(s, m.idx);
  if (m.action === "flag") return G.flag(s, m.idx);
  return G.chord(s, m.idx);
}

// Server seconds from the first reveal to the end (or to now while the game runs), to a tenth.
export function liveSeconds(log: StoredMove[], g: G.GameState, now: number): number {
  const first = log.find((m) => m.action === "reveal");
  if (!first) return 0;
  const end = over(g) ? log[log.length - 1].t : now;
  return Math.round(Math.max(0, end - first.t) / 100) / 10;
}

export function replayLog(board: Board, log: StoredMove[]): G.GameState {
  return log.reduce((s, m) => apply(s, m), G.newGame(board));
}

export function toLive(g: G.GameState, log: StoredMove[], now: number): LiveState {
  return {
    board: over(g) ? g.board : maskBoard(g.board, g.revealed),
    revealed: g.revealed,
    flagged: g.flagged,
    shielded: g.shielded,
    shieldsLeft: g.shieldsLeft,
    status: g.status,
    started: g.started,
    hit: g.hit,
    moves: g.moves,
    elapsed: liveSeconds(log, g, now),
  };
}

export function parseMove(x: unknown): G.Move | null {
  if (!x || typeof x !== "object") return null;
  const { action, idx } = x as Record<string, unknown>;
  if (action !== "reveal" && action !== "flag" && action !== "chord") return null;
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx > 10_000) return null;
  return { action, idx };
}

// Try one move against the stored log. Moves that change nothing (or come after the end) are not kept.
export function playMove(board: Board, log: StoredMove[], move: G.Move, now: number) {
  const before = replayLog(board, log);
  const after = over(before) ? before : apply(before, move);
  const stored: StoredMove | null = after === before ? null : { ...move, t: now };
  const full = stored ? [...log, stored] : log;
  return { g: after, log: full, stored, justEnded: !over(before) && over(after) };
}

// Clicks that count as moves for the result (flags are free).
export const countMoves = (g: G.GameState) => g.moves.filter((m) => m.action !== "flag").length;

// A Portal's daily board: one shared game per Portal per UTC day, recorded on the server when it ends.
const dayKey = (tokenId: number, date: string) => `day:${date}:${tokenId}`;

export async function dailyState(store: RecordStore, board: Board, now: number): Promise<LiveState> {
  const log = await store.movesGet(dayKey(board.tokenId, board.date));
  return toLive(replayLog(board, log), log, now);
}

export async function dailyMove(store: RecordStore, board: Board, move: G.Move, now: number): Promise<LiveState> {
  const key = dayKey(board.tokenId, board.date);
  const played = playMove(board, await store.movesGet(key), move, now);
  if (played.stored) await store.movesAdd(key, played.stored);
  const live = toLive(played.g, played.log, now);
  if (played.justEnded)
    await store.submit({ tokenId: board.tokenId, date: board.date, won: played.g.status === "won", seconds: live.elapsed, moves: countMoves(played.g) });
  return live;
}
