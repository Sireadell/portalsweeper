// Potsweeper play logic. Pure functions: every call returns a new state.
import { encodePacked, keccak256 } from "viem";
import { computeCells, glazeStrength, neighbors, pickDistinct, rngStream } from "./engine";
import type { Board } from "./types";

export type MoveAction = "reveal" | "flag" | "chord";
export type Move = { action: MoveAction; idx: number };
export type Status = "ready" | "playing" | "won" | "lost";

export type GameState = {
  board: Board; // current board (mines may move once, on the first reveal)
  revealed: boolean[];
  flagged: boolean[];
  shielded: number[]; // mines the player stepped on and survived (shown as revealed)
  shieldsLeft: number;
  status: Status;
  started: boolean; // first reveal done
  hit?: number; // the mine that ended the game
  moves: Move[];
};

// Cell indexes that must stay mine free for the first click, in order of preference.
// Wide (reflective glaze) peek keeps the peek and its neighbours clear, then falls back.
function protectionOptions(board: Board, click: number): number[][] {
  const { cols, rows } = board;
  const zone = (c: number) => [c, ...neighbors(c, cols, rows)];
  const peek = board.freePeek;
  const glaze = board.rules.find((r) => r.id === "glaze-peek");
  const wide = peek !== undefined && glaze !== undefined && glazeStrength(glaze.value) === "wide";
  const opts: number[][] = [];
  if (wide) opts.push([...zone(click), ...zone(peek)]);
  opts.push(zone(click));
  if (peek !== undefined) opts.push([click, peek]);
  opts.push([click]);
  return opts.map((o) => Array.from(new Set(o)));
}

// Make the first click safe by moving mines out of the way. Deterministic:
// the random stream comes from public board facts (token, date, commit, click).
// The Charm pre-flagged mine never moves. The free peek cell stays safe.
export function applyFirstClick(board: Board, click: number): Board {
  const keep = board.freeFlag;
  if (click === keep) return board; // a flagged cell cannot be opened anyway
  const isMine = board.cells.map((c) => c.mine);
  const total = board.cols * board.rows;
  const seed = keccak256(
    encodePacked(
      ["string", "uint256", "string", "string", "uint256"],
      ["relocate", BigInt(board.tokenId), board.date, board.commit, BigInt(click)],
    ),
  );
  for (const zone of protectionOptions(board, click)) {
    const inZone = new Set(zone);
    if (board.freePeek !== undefined) inZone.add(board.freePeek);
    const movers = zone.filter((i) => isMine[i] && i !== keep);
    if (movers.length === 0) return board;
    const dests: number[] = [];
    for (let i = 0; i < total; i++) if (!inZone.has(i) && !isMine[i]) dests.push(i);
    if (dests.length < movers.length) continue;
    const next = isMine.slice();
    const picks = pickDistinct(dests, movers.length, rngStream(seed));
    movers.forEach((m, k) => {
      next[m] = false;
      next[picks[k]] = true;
    });
    return { ...board, cells: computeCells(next, board.cols, board.rows) };
  }
  return board;
}

export function newGame(board: Board): GameState {
  const flagged = new Array(board.cols * board.rows).fill(false);
  if (board.freeFlag !== undefined) flagged[board.freeFlag] = true;
  return {
    board,
    revealed: new Array(board.cols * board.rows).fill(false),
    flagged,
    shielded: [],
    shieldsLeft: board.shields,
    status: "ready",
    started: false,
    moves: [],
  };
}

function clone(s: GameState): GameState {
  return { ...s, revealed: s.revealed.slice(), flagged: s.flagged.slice(), shielded: s.shielded.slice(), moves: s.moves.slice() };
}

function inRange(s: GameState, idx: number): boolean {
  return Number.isInteger(idx) && idx >= 0 && idx < s.board.cells.length;
}
const over = (s: GameState) => s.status === "won" || s.status === "lost";

// Open a cell, flood filling through zeros. Returns false if a deadly mine was hit.
function openCell(s: GameState, start: number): void {
  const { cols, rows, cells } = s.board;
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (s.revealed[i] || s.flagged[i]) continue;
    if (cells[i].mine) {
      if (s.shieldsLeft > 0) {
        s.shieldsLeft--;
        s.revealed[i] = true;
        s.shielded.push(i);
      } else {
        s.revealed[i] = true;
        s.hit = i;
        s.status = "lost";
        return;
      }
      continue;
    }
    s.revealed[i] = true;
    if (cells[i].adj === 0) for (const n of neighbors(i, cols, rows)) stack.push(n);
  }
}

function checkWin(s: GameState): void {
  if (s.status !== "playing") return;
  for (let i = 0; i < s.board.cells.length; i++) {
    if (!s.board.cells[i].mine && !s.revealed[i]) return;
  }
  s.status = "won";
}

function begin(s: GameState, idx: number): void {
  s.board = applyFirstClick(s.board, idx);
  s.started = true;
  s.status = "playing";
}

// Reveal a hidden, unflagged cell. The first reveal is always safe.
export function reveal(state: GameState, idx: number): GameState {
  if (over(state) || !inRange(state, idx) || state.revealed[idx] || state.flagged[idx]) return state;
  const s = clone(state);
  if (!s.started) {
    begin(s, idx);
    openCell(s, idx);
    // The free peek is revealed together with the first click.
    if (s.board.freePeek !== undefined) openCell(s, s.board.freePeek);
  } else {
    openCell(s, idx);
  }
  s.moves.push({ action: "reveal", idx });
  checkWin(s);
  return s;
}

// Toggle a flag on a hidden cell. The pre-flagged mine cannot be removed.
export function flag(state: GameState, idx: number): GameState {
  if (over(state) || !inRange(state, idx) || state.revealed[idx]) return state;
  if (idx === state.board.freeFlag) return state;
  const s = clone(state);
  s.flagged[idx] = !s.flagged[idx];
  s.moves.push({ action: "flag", idx });
  return s;
}

// Reveal all hidden neighbours of a number once enough flags surround it.
export function chord(state: GameState, idx: number): GameState {
  if (over(state) || !state.started || !inRange(state, idx) || !state.revealed[idx]) return state;
  const { cols, rows, cells } = state.board;
  if (cells[idx].mine || cells[idx].adj === 0) return state;
  const around = neighbors(idx, cols, rows);
  // Survived mines count as marked.
  const marked = around.filter((n) => state.flagged[n] || state.shielded.includes(n)).length;
  if (marked !== cells[idx].adj) return state;
  const targets = around.filter((n) => !state.revealed[n] && !state.flagged[n]);
  if (targets.length === 0) return state;
  const s = clone(state);
  for (const n of targets) {
    if (over(s)) break;
    openCell(s, n);
  }
  s.moves.push({ action: "chord", idx });
  checkWin(s);
  return s;
}

// Replay a move log from a fresh board. Live play and replay give the same result.
export function replay(board: Board, moves: Move[]): GameState {
  let s = newGame(board);
  for (const m of moves) {
    if (m.action === "reveal") s = reveal(s, m.idx);
    else if (m.action === "flag") s = flag(s, m.idx);
    else s = chord(s, m.idx);
  }
  return s;
}
