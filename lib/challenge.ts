// Friend challenges (PvP by link). A player makes a challenge, anyone with the link can take the other
// seat, and both play the same board. The server keeps the mines and the clock, exactly as it does for the
// Portal of the day: the browser sends one move at a time and gets back only what is open.
//
// For the stakes feature: read the result with getChallengeWinner(store, id). It says whether the
// challenge is settled and, if so, who won (a lowercase 0x wallet) or that nobody did.
import { randomBytes } from "node:crypto";
import { keccak256, recoverMessageAddress, toBytes, type Hex } from "viem";
import { PORTAL_SUPPLY, type Board } from "./types";
import { challengeCreateMessage, challengePlayMessage } from "./challenge-message";
import { utcToday } from "./salt";
import { countMoves, parseMove, playMove, replayLog, toLive, type LiveState } from "./live";
import { createStake, parseTpot, type StakeDeps, type StakeRecord } from "./stakes";
import { resolveStake } from "./challengeStakes";
import type { Challenge, ChallengeEntries, ChallengeEntry, ChallengeSlot, RecordStore } from "./records";

export const CHALLENGE_LIFE_MS = 24 * 3_600_000; // how long a link stays open for a second player
export const RUN_LIMIT_MS = 60 * 60_000; // a started try must finish within an hour or it counts as a loss

export type ChallengeError = { ok: false; status: number; error: string };
export type ChallengeDeps = {
  store: RecordStore;
  now?: () => number;
  recover?: (message: string, signature: string) => Promise<string>;
  board: (c: Challenge) => Promise<Board>; // the real board (server only: it needs the seed)
  newId?: () => string;
  newSeed?: () => string;
  stakes?: StakeDeps | null; // set only when stakes are switched on; without it challenges ignore stakes
};

const recoverDefault = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });
const ID_RE = /^[0-9a-f]{12}$/;
export const isChallengeId = (x: unknown): x is string => typeof x === "string" && ID_RE.test(x);

async function whoSigned(deps: ChallengeDeps, address: unknown, signature: unknown, message: string): Promise<string | ChallengeError> {
  if (typeof address !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return { ok: false, status: 400, error: "Connect your wallet and sign to play." };
  try {
    const who = await (deps.recover ?? recoverDefault)(message, signature);
    if (who.toLowerCase() !== address.toLowerCase()) return { ok: false, status: 401, error: "That signature does not match your wallet." };
    return who.toLowerCase();
  } catch {
    return { ok: false, status: 401, error: "Could not read that signature." };
  }
}

export function portalForSeed(seed: string): number {
  return Number(BigInt(keccak256(toBytes(seed))) % BigInt(PORTAL_SUPPLY)) + 1;
}

// ---------------------------------------------------------------------------
// The result, as one pure function
// ---------------------------------------------------------------------------
export type ChallengeStatus = "open" | "playing" | "done" | "expired";
export type ChallengeReason = "faster" | "opponent-lost" | "forfeit" | "draw" | "expired";
export type ChallengeOutcome = {
  status: ChallengeStatus; // open: waiting for a second player. playing: both in, not both finished.
  settled: boolean; // true once the result can no longer change
  winner: string | null; // lowercase 0x wallet, only when settled and someone won
  reason: ChallengeReason | null;
};

type Seat = "won" | "lost" | "running" | "waiting";

function seatState(e: ChallengeEntry | undefined, ch: Challenge, now: number): Seat {
  if (e?.finishedAt) return e.won ? "won" : "lost";
  if (e) return now > e.startedAt + RUN_LIMIT_MS ? "lost" : "running"; // ran out of time counts as a loss
  return now > ch.expiresAt ? "lost" : "waiting"; // never turned up
}

// Rules: both cleared, the faster clear wins (a tie goes to whoever finished first). One cleared and the
// other hit a mine or ran out of time, the one who cleared wins. Nobody cleared, or nobody took the
// second seat before the link expired, nobody wins.
export function challengeOutcome(ch: Challenge, entries: ChallengeEntries, now: number): ChallengeOutcome {
  const { creator: c, opponent: o } = entries;
  const cs = seatState(c, ch, now);
  const os = seatState(o, ch, now);
  if (!o) {
    return now <= ch.expiresAt
      ? { status: "open", settled: false, winner: null, reason: null }
      : { status: "expired", settled: true, winner: null, reason: "expired" };
  }
  if (cs === "running" || cs === "waiting" || os === "running" || os === "waiting")
    return { status: "playing", settled: false, winner: null, reason: null };
  const done = (winner: string | null, reason: ChallengeReason): ChallengeOutcome => ({ status: "done", settled: true, winner, reason });
  if (cs === "won" && os === "won") {
    const gap = c!.seconds! - o.seconds! || c!.finishedAt! - o.finishedAt!;
    return done(gap <= 0 ? c!.wallet : o.wallet, "faster");
  }
  if (cs === "won") return done(c!.wallet, o.finishedAt ? "opponent-lost" : "forfeit");
  if (os === "won") return done(o.wallet, c?.finishedAt ? "opponent-lost" : "forfeit");
  return done(null, "draw");
}

export type ChallengeWinner =
  | { found: false }
  | { found: true; settled: false; winner: null }
  | { found: true; settled: true; winner: string | null; reason: ChallengeReason };

// The clean read for other features (stakes). Never settles early; a settled result never changes.
//   found false:           no challenge with that id
//   settled false:         still open or being played, do not pay out
//   settled true, winner:  lowercase 0x wallet of the winner, null when nobody won (draw or expired)
export async function getChallengeWinner(store: RecordStore, id: string, now: number = Date.now()): Promise<ChallengeWinner> {
  const ch = await store.challengeGet(id);
  if (!ch) return { found: false };
  const out = challengeOutcome(ch, await store.challengeEntries(id), now);
  if (!out.settled) return { found: true, settled: false, winner: null };
  return { found: true, settled: true, winner: out.winner, reason: out.reason! };
}

// ---------------------------------------------------------------------------
// What the browser may see. Never the seed, never mines of a board still in play.
// ---------------------------------------------------------------------------
export type ChallengePlayerView = {
  role: ChallengeSlot;
  wallet: string | null; // null while the seat is empty
  joined: boolean;
  finished: boolean;
  // times stay hidden until the result is settled, so nobody races a number they can see
  won?: boolean;
  seconds?: number;
  moves?: number;
};
export type ChallengeView = {
  id: string;
  tokenId: number;
  status: ChallengeStatus;
  settled: boolean;
  winner: string | null;
  reason: ChallengeReason | null;
  createdAt: number;
  expiresAt: number;
  players: ChallengePlayerView[];
};

export function challengeView(ch: Challenge, entries: ChallengeEntries, now: number): ChallengeView {
  const out = challengeOutcome(ch, entries, now);
  const seat = (role: ChallengeSlot): ChallengePlayerView => {
    const e = entries[role];
    const p: ChallengePlayerView = { role, wallet: role === "creator" ? ch.creator : e?.wallet ?? null, joined: !!e, finished: !!e?.finishedAt };
    if (out.settled && e?.finishedAt) Object.assign(p, { won: e.won, seconds: e.seconds, moves: e.moves });
    return p;
  };
  return {
    id: ch.id, tokenId: ch.tokenId, status: out.status, settled: out.settled, winner: out.winner, reason: out.reason,
    createdAt: ch.createdAt, expiresAt: ch.expiresAt, players: [seat("creator"), seat("opponent")],
  };
}

// Pays the winner or refunds, once the challenge is settled. Does nothing without stakes, and a stake
// that is already paid is just returned, so this is safe to call on every read and every move.
export async function resolveChallengeStake(deps: ChallengeDeps, id: string, now: number = (deps.now ?? Date.now)()): Promise<StakeRecord | null> {
  if (!deps.stakes) return null;
  return resolveStake(deps.stakes, id, await getChallengeWinner(deps.store, id, now));
}

export async function getChallengeView(store: RecordStore, id: string, now: number = Date.now()): Promise<ChallengeView | null> {
  const ch = await store.challengeGet(id);
  return ch ? challengeView(ch, await store.challengeEntries(id), now) : null;
}

// ---------------------------------------------------------------------------
// Create, start, move
// ---------------------------------------------------------------------------
export async function createChallenge(
  deps: ChallengeDeps,
  input: { address: unknown; signature: unknown; tokenId?: unknown; stakeTpot?: unknown },
): Promise<{ ok: true; challenge: ChallengeView } | ChallengeError> {
  const now = (deps.now ?? Date.now)();
  const date = utcToday(new Date(now));
  const who = await whoSigned(deps, input.address, input.signature, challengeCreateMessage(date));
  if (typeof who !== "string") return who;
  let stakeTpot: string | null = null;
  if (deps.stakes && input.stakeTpot !== undefined && input.stakeTpot !== null && input.stakeTpot !== "" && input.stakeTpot !== "0") {
    try {
      if (typeof input.stakeTpot !== "string") throw new Error("Amount must be a plain number like 0.05.");
      parseTpot(input.stakeTpot);
      stakeTpot = input.stakeTpot;
    } catch (e) {
      return { ok: false, status: 400, error: e instanceof Error ? e.message : "That stake is not valid." };
    }
  }
  const seed = (deps.newSeed ?? (() => `0x${randomBytes(32).toString("hex")}`))();
  let tokenId = portalForSeed(seed);
  if (input.tokenId !== undefined) {
    if (typeof input.tokenId !== "number" || !Number.isInteger(input.tokenId) || input.tokenId < 1 || input.tokenId > PORTAL_SUPPLY)
      return { ok: false, status: 400, error: `Pick a Portal number from 1 to ${PORTAL_SUPPLY}.` };
    tokenId = input.tokenId;
  }
  for (let tries = 0; tries < 5; tries++) {
    const ch: Challenge = { id: (deps.newId ?? (() => randomBytes(6).toString("hex")))(), seed, tokenId, date, creator: who, createdAt: now, expiresAt: now + CHALLENGE_LIFE_MS };
    if (await deps.store.challengeCreate(ch)) {
      if (stakeTpot && deps.stakes) {
        try {
          await createStake(deps.stakes, ch.id, { creator: who, amountTpot: stakeTpot });
        } catch {
          return { ok: false, status: 500, error: "The challenge was made but its stake could not be set. Make a new one." };
        }
      }
      return { ok: true, challenge: challengeView(ch, {}, now) };
    }
  }
  return { ok: false, status: 500, error: "Could not make a challenge. Try again." };
}

const gameKey = (id: string, wallet: string) => `challenge:${id}:${wallet}`;
const NOT_FOUND: ChallengeError = { ok: false, status: 404, error: "That challenge link does not exist." };

// Take a seat (the creator's, or the second one for anyone else) or pick a running try back up.
// A refresh does not cost the try. A finished try cannot start again.
export async function startChallenge(
  deps: ChallengeDeps,
  input: { id: unknown; address: unknown; signature: unknown },
): Promise<{ ok: true; slot: ChallengeSlot; live: LiveState; challenge: ChallengeView } | ChallengeError> {
  if (!isChallengeId(input.id)) return NOT_FOUND;
  const now = (deps.now ?? Date.now)();
  const ch = await deps.store.challengeGet(input.id);
  if (!ch) return NOT_FOUND;
  const who = await whoSigned(deps, input.address, input.signature, challengePlayMessage(ch.id));
  if (typeof who !== "string") return who;
  const slot: ChallengeSlot = who === ch.creator ? "creator" : "opponent";
  const mine = (await deps.store.challengeEntries(ch.id))[slot];
  let entry = mine;
  if (entry && entry.wallet !== who) return { ok: false, status: 409, error: "This challenge already has two players." };
  if (!entry) {
    if (now > ch.expiresAt) return { ok: false, status: 410, error: "This challenge link has expired." };
    // With a stake on the table nobody sits down until both have locked theirs, and only those two may.
    const stake = deps.stakes ? await deps.stakes.store.get(ch.id) : null;
    if (stake) {
      if (stake.status !== "locked" && stake.status !== "open") return { ok: false, status: 403, error: "The stake on this challenge is closed." };
      if (!stake.locks.some((l) => l.wallet === who)) return { ok: false, status: 403, error: "Lock your stake first. Both players must put up the same stake before anyone plays." };
      if (stake.status !== "locked") return { ok: false, status: 403, error: "Waiting for the other player to lock their stake." };
    }
    const seat = await deps.store.challengeSeat(ch.id, slot, { wallet: who, startedAt: now });
    if (!seat.ok && seat.entry.wallet !== who) return { ok: false, status: 409, error: "This challenge already has two players." };
    entry = seat.entry;
  }
  const board = await deps.board(ch);
  const log = await deps.store.movesGet(gameKey(ch.id, who));
  const live = toLive(replayLog(board, log), log, now);
  return { ok: true, slot, live, challenge: (await getChallengeView(deps.store, ch.id, now))! };
}

// One move of a challenge try. The server keeps the mines, checks the move and keeps the clock. When
// the move ends the game the result is recorded right here: the browser never reports a time.
export async function moveChallenge(
  deps: ChallengeDeps,
  input: { id: unknown; address: unknown; signature: unknown; move: unknown },
): Promise<{ ok: true; live: LiveState; challenge?: ChallengeView } | ChallengeError> {
  if (!isChallengeId(input.id)) return NOT_FOUND;
  const now = (deps.now ?? Date.now)();
  const move = parseMove(input.move);
  if (!move) return { ok: false, status: 400, error: "That move is not valid." };
  const ch = await deps.store.challengeGet(input.id);
  if (!ch) return NOT_FOUND;
  const who = await whoSigned(deps, input.address, input.signature, challengePlayMessage(ch.id));
  if (typeof who !== "string") return who;
  const slot: ChallengeSlot = who === ch.creator ? "creator" : "opponent";
  const cur = (await deps.store.challengeEntries(ch.id))[slot];
  if (!cur || cur.wallet !== who) return { ok: false, status: 400, error: "Press Start before playing." };
  const board = await deps.board(ch);
  const key = gameKey(ch.id, who);
  if (!cur.finishedAt && now > cur.startedAt + RUN_LIMIT_MS)
    return { ok: false, status: 410, error: "Your hour is up, so this try counts as a loss." };
  const played = playMove(board, await deps.store.movesGet(key), move, now);
  if (played.stored && !cur.finishedAt) await deps.store.movesAdd(key, played.stored);
  const live = toLive(played.g, played.log, now);
  if (!played.justEnded || cur.finishedAt) return { ok: true, live };
  await deps.store.challengeFinish(ch.id, slot, { won: played.g.status === "won", seconds: live.elapsed, moves: countMoves(played.g), at: now });
  // The pot is paid by whoever sees the result first; if that fails the page or the timer tries again.
  try { await resolveChallengeStake(deps, ch.id, now); } catch (e) { console.error("stake payout failed", ch.id, e instanceof Error ? e.message : e); }
  return { ok: true, live, challenge: (await getChallengeView(deps.store, ch.id, now)) ?? undefined };
}
