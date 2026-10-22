import { keccak256, recoverMessageAddress, toBytes, type Hex } from "viem";
import { PORTAL_SUPPLY } from "./types";
import { cotdMessage } from "./cotd-message";
import { addDays, dailyCommit, utcToday } from "./salt";
import { rankCotd, type CotdEntry, type RecordStore } from "./records";
import { countMoves, parseMove, playMove, replayLog, toLive, type LiveState } from "./live";
import type { Board } from "./types";

// One unclaimed Portal is featured per UTC day, picked from the date and the public daily commit.
// Anyone can recompute it once the commit is posted: id = keccak256("portal-of-the-day:DATE:COMMIT") mod 500 + 1,
// then step forward past Portals already won on an earlier day and the Portal featured the day before.
export function pickPortalOfDay(date: string, commit: string, taken: ReadonlySet<number> = new Set()): number {
  const h = BigInt(keccak256(toBytes(`portal-of-the-day:${date}:${commit}`)));
  let id = Number(h % BigInt(PORTAL_SUPPLY)) + 1;
  for (let i = 0; i < PORTAL_SUPPLY && taken.has(id); i++) id = (id % PORTAL_SUPPLY) + 1;
  return id;
}

export async function portalOfDay(store: RecordStore, date: string): Promise<number> {
  const fixed = await store.featuredGet(date);
  if (fixed) return fixed;
  const taken = new Set((await store.claimList()).filter((c) => c.date < date).map((c) => c.tokenId));
  const prev = await store.featuredGet(addDays(date, -1));
  if (prev) taken.add(prev);
  return store.featuredSet(date, pickPortalOfDay(date, dailyCommit(date), taken));
}

export function nextUtcMidnight(now: Date = new Date()): number {
  return Date.parse(`${addDays(utcToday(now), 1)}T00:00:00Z`);
}

export { cotdMessage };

export const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export type CotdDeps = {
  store: RecordStore;
  now?: () => number;
  recover?: (message: string, signature: string) => Promise<string>;
};

export type CotdError = { ok: false; status: number; error: string };

const recoverDefault = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });

async function whoSigned(deps: CotdDeps, address: unknown, signature: unknown, date: string): Promise<string | CotdError> {
  if (typeof address !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return { ok: false, status: 400, error: "Connect your wallet and sign to play." };
  try {
    const who = await (deps.recover ?? recoverDefault)(cotdMessage(date), signature);
    if (who.toLowerCase() !== address.toLowerCase()) return { ok: false, status: 401, error: "That signature does not match your wallet." };
    return who.toLowerCase();
  } catch {
    return { ok: false, status: 401, error: "Could not read that signature." };
  }
}

// Builds the real board for a Portal on a day (server only: it needs the daily salt).
export type BoardFor = (tokenId: number, date: string) => Promise<Board>;

const gameKey = (date: string, wallet: string) => `cotd:${date}:${wallet}`;

// Start (or pick back up) the one ranked try. A try that is still running comes back as it was,
// so a refresh does not cost the try. A finished try cannot start again.
export async function startRanked(
  deps: CotdDeps & { board: BoardFor },
  input: { address: unknown; signature: unknown },
): Promise<{ ok: true; entry: CotdEntry; live: LiveState } | CotdError | { ok: false; status: 409; error: string; entry: CotdEntry }> {
  const now = (deps.now ?? Date.now)();
  const date = utcToday(new Date(now));
  const who = await whoSigned(deps, input.address, input.signature, date);
  if (typeof who !== "string") return who;
  const out = await deps.store.cotdStart({ date, wallet: who, tokenId: await portalOfDay(deps.store, date), startedAt: now });
  if (!out.ok && out.entry.finishedAt) return { ok: false, status: 409, error: "You already took today's ranked try.", entry: out.entry };
  const log = await deps.store.movesGet(gameKey(date, who));
  const board = await deps.board(out.entry.tokenId, date);
  return { ok: true, entry: out.entry, live: toLive(replayLog(board, log), log, now) };
}

// One move of a ranked try. The server keeps the mines, checks the move and keeps the clock.
// When the move ends the game, the result is recorded right here: the browser never reports a time.
export async function moveRanked(
  deps: CotdDeps & { board: BoardFor },
  input: { address: unknown; signature: unknown; date: unknown; move: unknown },
): Promise<{ ok: true; live: LiveState; rank?: number | null } | CotdError> {
  const now = (deps.now ?? Date.now)();
  const today = utcToday(new Date(now));
  const date = input.date;
  // A try started just before midnight may finish just after it.
  if (typeof date !== "string" || (date !== today && date !== addDays(today, -1)))
    return { ok: false, status: 400, error: "That ranked day is closed." };
  const move = parseMove(input.move);
  if (!move) return { ok: false, status: 400, error: "That move is not valid." };
  const who = await whoSigned(deps, input.address, input.signature, date);
  if (typeof who !== "string") return who;
  const cur = await deps.store.cotdEntry(date, who);
  if (!cur) return { ok: false, status: 400, error: "Press Start before playing a ranked try." };
  const board = await deps.board(cur.tokenId, date);
  const key = gameKey(date, who);
  const played = playMove(board, await deps.store.movesGet(key), move, now);
  if (played.stored && !cur.finishedAt) await deps.store.movesAdd(key, played.stored);
  const live = toLive(played.g, played.log, now);
  if (!played.justEnded || cur.finishedAt) return { ok: true, live };
  const out = await deps.store.cotdFinish(date, who, { won: played.g.status === "won", seconds: live.elapsed, moves: countMoves(played.g), at: now });
  if (!out.ok) return { ok: true, live };
  const ranked = rankCotd(await deps.store.cotdEntries(date));
  const idx = ranked.findIndex((e) => e.wallet === who);
  return { ok: true, live, rank: idx >= 0 ? idx + 1 : null };
}

export type CotdSummary = {
  date: string;
  tokenId: number;
  nextUtc: number;
  attempts: number;
  cleared: number; // ranked wins today
  recent: { wallet: string; seconds: number; at: number }[]; // latest ranked wins, newest first
  leaderboard: { rank: number; wallet: string; seconds: number; moves: number }[];
  yesterday: { date: string; tokenId: number; winner: { wallet: string; seconds: number } | null };
  mine?: { started: boolean; finished: boolean; won?: boolean; seconds?: number; rank: number | null };
};

// The latest few ranked wins, newest first.
export function recentClears(entries: CotdEntry[], n = 5): CotdSummary["recent"] {
  return entries
    .filter((e) => e.won === true && typeof e.seconds === "number")
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .slice(0, n)
    .map((e) => ({ wallet: shortWallet(e.wallet), seconds: e.seconds!, at: e.finishedAt ?? 0 }));
}

export async function summarize(store: RecordStore, now: Date = new Date(), address?: string | null): Promise<CotdSummary> {
  const date = utcToday(now);
  const prev = addDays(date, -1);
  const [entries, prevEntries] = await Promise.all([store.cotdEntries(date), store.cotdEntries(prev)]);
  const ranked = rankCotd(entries);
  const board = ranked.slice(0, 25).map((e, i) => ({ rank: i + 1, wallet: shortWallet(e.wallet), seconds: e.seconds!, moves: e.moves ?? 0 }));
  const win = rankCotd(prevEntries)[0];
  const out: CotdSummary = {
    date,
    tokenId: await portalOfDay(store, date),
    nextUtc: nextUtcMidnight(now),
    attempts: entries.length,
    cleared: ranked.length,
    recent: recentClears(entries),
    leaderboard: board,
    yesterday: { date: prev, tokenId: (await store.featuredGet(prev)) ?? (await portalOfDay(store, prev)), winner: win ? { wallet: shortWallet(win.wallet), seconds: win.seconds! } : null },
  };
  if (address) {
    const w = address.toLowerCase();
    const mine = entries.find((e) => e.wallet === w);
    if (mine) {
      const idx = ranked.findIndex((e) => e.wallet === w);
      out.mine = { started: true, finished: !!mine.finishedAt, won: mine.won, seconds: mine.seconds, rank: idx >= 0 ? idx + 1 : null };
    }
  }
  return out;
}
