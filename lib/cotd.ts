import { keccak256, recoverMessageAddress, toBytes, type Hex } from "viem";
import { PORTAL_SUPPLY } from "./types";
import { cotdMessage } from "./cotd-message";
import { addDays, dailyCommit, utcToday } from "./salt";
import { rankCotd, type CotdEntry, type RecordStore } from "./records";

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

export async function startRanked(
  deps: CotdDeps,
  input: { address: unknown; signature: unknown },
): Promise<{ ok: true; entry: CotdEntry } | CotdError | { ok: false; status: 409; error: string; entry: CotdEntry }> {
  const now = (deps.now ?? Date.now)();
  const date = utcToday(new Date(now));
  const who = await whoSigned(deps, input.address, input.signature, date);
  if (typeof who !== "string") return who;
  const out = await deps.store.cotdStart({ date, wallet: who, tokenId: await portalOfDay(deps.store, date), startedAt: now });
  if (!out.ok) return { ok: false, status: 409, error: "You already took today's ranked try.", entry: out.entry };
  return { ok: true, entry: out.entry };
}

export async function finishRanked(
  deps: CotdDeps,
  input: { address: unknown; signature: unknown; date: unknown; won: unknown; seconds: unknown; moves: unknown },
): Promise<{ ok: true; entry: CotdEntry; rank: number | null } | CotdError> {
  const now = (deps.now ?? Date.now)();
  const today = utcToday(new Date(now));
  const date = input.date;
  // A try started just before midnight may finish just after it.
  if (typeof date !== "string" || (date !== today && date !== addDays(today, -1)))
    return { ok: false, status: 400, error: "That ranked day is closed." };
  if (typeof input.won !== "boolean") return { ok: false, status: 400, error: "won must be true or false." };
  if (typeof input.seconds !== "number" || !(input.seconds >= 0 && input.seconds <= 86_400))
    return { ok: false, status: 400, error: "seconds is out of range." };
  const moves = Array.isArray(input.moves) ? input.moves.length : input.moves;
  if (typeof moves !== "number" || !Number.isInteger(moves) || moves < 0 || moves > 100_000)
    return { ok: false, status: 400, error: "moves is out of range." };
  const who = await whoSigned(deps, input.address, input.signature, date);
  if (typeof who !== "string") return who;
  const cur = await deps.store.cotdEntry(date, who);
  if (!cur) return { ok: false, status: 400, error: "Press Start before finishing a ranked try." };
  // The clock on the server decides the longest believable time: nobody can take longer than has passed.
  const elapsed = (now - cur.startedAt) / 1000;
  if (input.seconds > elapsed + 3) return { ok: false, status: 400, error: "That time is longer than the try has been open." };
  const seconds = Math.round(input.seconds * 10) / 10;
  const out = await deps.store.cotdFinish(date, who, { won: input.won, seconds, moves, at: now });
  if (!out.ok) return { ok: false, status: 409, error: out.reason === "not-started" ? "Press Start first." : "Your ranked try is already recorded." };
  const ranked = rankCotd(await deps.store.cotdEntries(date));
  const idx = ranked.findIndex((e) => e.wallet === who);
  return { ok: true, entry: out.entry, rank: idx >= 0 ? idx + 1 : null };
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
