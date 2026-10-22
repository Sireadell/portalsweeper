// Practice mode helpers: fresh random seeds, next-Pot picking and the browser-kept chain score.
// Practice salts are random per board and are never the daily salt, so nothing leaks about daily boards.
import { POT_SUPPLY } from "./types";

export const PRACTICE_KEY = "potsweeper:practice:v1";

export type PracticeStats = { streak: number; best: number; tiles: number; boards: number };
export const EMPTY_STATS: PracticeStats = { streak: 0, best: 0, tiles: 0, boards: 0 };

type Rand = () => number;

function hex(n: number): string {
  let out = "";
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint8Array(n);
    c.getRandomValues(a);
    for (const b of a) out += b.toString(16).padStart(2, "0");
    return out;
  }
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return out;
}

// A fresh 128-bit salt for one practice board. The "practice-" prefix can never equal a daily salt (0x + hex).
export function newPracticeSalt(): string {
  return `practice-${hex(16)}`;
}

export function isPracticeSalt(salt: string): boolean {
  return /^practice-[0-9a-f]{32}$/.test(salt);
}

export function randomPotId(rand: Rand = Math.random): number {
  return 1 + Math.floor(rand() * POT_SUPPLY);
}

// The next Pot in the chain: a random one that is not the current one.
export function nextPotId(current: number, rand: Rand = Math.random): number {
  let id = randomPotId(rand);
  if (id === current) id = (id % POT_SUPPLY) + 1;
  return id;
}

export function parsePotId(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= POT_SUPPLY ? n : null;
}

// Safe tiles opened on a board: all non-mine tiles, which a win clears.
export function tilesForBoard(cols: number, rows: number, mines: number): number {
  return Math.max(0, cols * rows - mines);
}

export function applyResult(s: PracticeStats, won: boolean, tiles: number): PracticeStats {
  if (!won) return { ...s, streak: 0, boards: s.boards + 1 };
  const streak = s.streak + 1;
  return { streak, best: Math.max(s.best, streak), tiles: s.tiles + tiles, boards: s.boards + 1 };
}

export function readStats(): PracticeStats {
  try {
    const o = JSON.parse(localStorage.getItem(PRACTICE_KEY) ?? "null") as Partial<PracticeStats> | null;
    if (!o) return EMPTY_STATS;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { streak: n(o.streak), best: n(o.best), tiles: n(o.tiles), boards: n(o.boards) };
  } catch {
    return EMPTY_STATS;
  }
}

export function writeStats(s: PracticeStats): void {
  try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(s)); } catch { /* storage may be blocked, play still works */ }
}
