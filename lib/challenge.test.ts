import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore, UpstashRecordStore, type Challenge, type ChallengeEntries, type RecordStore } from "./records";
import {
  CHALLENGE_LIFE_MS, RUN_LIMIT_MS, DUEL_COUNTDOWN_MS, cancelChallenge, challengeBoards, challengeOutcome, challengeProgress, createChallenge, getChallengeView, getChallengeWinner, moveChallenge, startChallenge,
  type ChallengeDeps,
} from "./challenge";
import { generateBoard } from "./engine";
import { getPortalMeta } from "./chain";
import { replayLog } from "./live";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const T0 = Date.parse("2026-10-20T12:00:00Z");

// A tiny in-memory stand-in for the Upstash REST API: only the commands the challenge store uses.
function fakeUpstash() {
  const kv = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();
  const run = (c: (string | number)[]): unknown => {
    const [op, key, ...a] = c.map(String);
    const h = () => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
    switch (op) {
      case "GET": return kv.get(key) ?? null;
      case "SET":
        if (a[1] === "NX" && kv.has(key)) return null;
        kv.set(key, a[0]);
        return "OK";
      case "HSETNX": if (h().has(a[0])) return 0; h().set(a[0], a[1]); return 1;
      case "HSET": h().set(a[0], a[1]); return 1;
      case "HGET": return hashes.get(key)?.get(a[0]) ?? null;
      case "HGETALL": return [...(hashes.get(key) ?? [])].flat();
      case "RPUSH": { const l = lists.get(key) ?? lists.set(key, []).get(key)!; l.push(a[0]); return l.length; }
      case "LRANGE": return lists.get(key) ?? [];
      case "EXPIRE": return 1;
      default: throw new Error(`fake: ${op}`);
    }
  };
  const fetchImpl = async (_url: string, init: { method: string; headers: Record<string, string>; body: string }) => ({
    ok: true, status: 200, json: async () => ({ result: run(JSON.parse(init.body) as (string | number)[]) }),
  });
  return { fetchImpl };
}

const file = () => new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"));
const stores: [string, () => RecordStore][] = [
  ["file", file],
  ["upstash (fake fetch)", () => new UpstashRecordStore("https://x.upstash.io/", "tok", fakeUpstash().fetchImpl)],
];

// The signature text is the wallet in these tests, so "who signed" is whoever the test says.
function make(store: RecordStore) {
  let t = T0;
  let signer = A;
  const deps: ChallengeDeps = {
    store,
    now: () => t,
    recover: async () => signer,
    board: async (c) => generateBoard(await getPortalMeta(c.tokenId), c.date, c.seed),
  };
  return {
    deps,
    as: (w: string) => { signer = w; return { address: w, signature: "0xsig" }; },
    advance: (s: number) => { t += s * 1000; },
  };
}

type Env = ReturnType<typeof make>;

// Plays a whole try one move at a time: safe cells (or a mine, to lose). Each move advances the clock.
async function play(env: Env, id: string, w: string, opts: { lose?: boolean; stepSeconds?: number } = {}) {
  const ch = (await env.deps.store.challengeGet(id))!;
  const real = await env.deps.board(ch);
  for (let n = 0; n < 500; n++) {
    const g = replayLog(real, await env.deps.store.movesGet(`challenge:${id}:${w}`));
    const pick = g.started && opts.lose
      ? g.board.cells.findIndex((c, i) => c.mine && !g.flagged[i] && !g.revealed[i])
      : g.board.cells.findIndex((c, i) => !c.mine && !g.revealed[i]);
    env.advance(opts.stepSeconds ?? 0);
    const out = await moveChallenge(env.deps, { id, ...env.as(w), move: { action: "reveal", idx: pick } });
    if (!out.ok) return out;
    if (out.live.status === "won" || out.live.status === "lost") return out;
  }
  throw new Error("game did not end");
}

async function setup(store: RecordStore) {
  const env = make(store);
  const made = await createChallenge(env.deps, env.as(A));
  if (!made.ok) throw new Error(made.error);
  return { env, id: made.challenge.id };
}

beforeAll(() => { process.env.PORTAL_SALT_SECRET = "test-secret"; });

describe.each(stores)("%s store: challenges", (_n, mk) => {
  it("keeps a challenge, hands out each seat once and finishes a seat once", async () => {
    const s = mk();
    const c: Challenge = { id: "abc123abc123", seed: "0x01", tokenId: 3, date: "2026-10-20", creator: A, createdAt: 1, expiresAt: 2 };
    expect(await s.challengeCreate(c)).toBe(true);
    expect(await s.challengeCreate({ ...c, seed: "0x02" })).toBe(false);
    expect(await s.challengeGet(c.id)).toEqual(c);
    expect(await s.challengeGet("nope")).toBeNull();
    expect((await s.challengeSeat(c.id, "opponent", { wallet: B, startedAt: 5 })).ok).toBe(true);
    const again = await s.challengeSeat(c.id, "opponent", { wallet: C, startedAt: 6 });
    expect(again).toMatchObject({ ok: false, entry: { wallet: B } });
    expect((await s.challengeFinish(c.id, "creator", { won: true, seconds: 1, moves: 1, at: 9 })).ok).toBe(false);
    expect((await s.challengeFinish(c.id, "opponent", { won: true, seconds: 12.3, moves: 4, at: 9 })).ok).toBe(true);
    expect((await s.challengeFinish(c.id, "opponent", { won: false, seconds: 1, moves: 1, at: 10 })).ok).toBe(false);
    expect(await s.challengeEntries(c.id)).toMatchObject({ opponent: { wallet: B, won: true, seconds: 12.3 } });
  });
});

describe("making a challenge", () => {
  it("needs a real signature and a valid Portal number", async () => {
    const env = make(file());
    expect(await createChallenge({ ...env.deps, recover: async () => { throw new Error("x"); } }, env.as(A))).toMatchObject({ ok: false, status: 401 });
    expect(await createChallenge({ ...env.deps, recover: async () => B }, env.as(A))).toMatchObject({ ok: false, status: 401 });
    expect(await createChallenge(env.deps, { address: "nope", signature: "x" })).toMatchObject({ ok: false, status: 400 });
    expect(await createChallenge(env.deps, { ...env.as(A), tokenId: 501 })).toMatchObject({ ok: false, status: 400 });
    expect(await createChallenge(env.deps, { ...env.as(A), tokenId: "7" })).toMatchObject({ ok: false, status: 400 });
    const ok = await createChallenge(env.deps, { ...env.as(A), tokenId: 7 });
    expect(ok).toMatchObject({ ok: true, challenge: { tokenId: 7, status: "open", settled: false, winner: null } });
  });

  it("never puts the seed in what the browser gets", async () => {
    const env = make(file());
    const made = await createChallenge(env.deps, env.as(A));
    if (!made.ok) throw new Error("create");
    const stored = (await env.deps.store.challengeGet(made.challenge.id))!;
    expect(JSON.stringify(made.challenge)).not.toContain(stored.seed);
    expect(made.challenge.id).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("playing a challenge", () => {
  it("lets two wallets play the same board, with the mines hidden until each is done", async () => {
    const { env, id } = await setup(file());
    const a = await startChallenge(env.deps, { id, ...env.as(A) });
    const b = await startChallenge(env.deps, { id, ...env.as(B) });
    if (!a.ok || !b.ok) throw new Error("start");
    expect(a.slot).toBe("creator");
    expect(b.slot).toBe("opponent");
    expect(a.live.board.cells.every((c) => !c.mine && c.adj === 0)).toBe(true);
    expect(b.live.board.cells.every((c) => !c.mine && c.adj === 0)).toBe(true);
    // same board for both
    const ch = (await env.deps.store.challengeGet(id))!;
    const real = await env.deps.board(ch);
    expect(a.live.board.cols).toBe(real.cols);
    expect(b.live.board.mines).toBe(real.mines);
    // a move opens cells but no unopened cell shows a mine
    const one = await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "reveal", idx: 0 } });
    if (!one.ok) throw new Error("move");
    one.live.board.cells.forEach((c, i) => { if (!one.live.revealed[i]) expect(c).toEqual({ mine: false, adj: 0 }); });
    expect(JSON.stringify(a.challenge)).not.toContain(ch.seed);
  });

  it("gives the win to the faster clear, times kept on the server", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(A) });
    await startChallenge(env.deps, { id, ...env.as(B) });
    const slow = await play(env, id, A, { stepSeconds: 2 });
    expect(slow).toMatchObject({ ok: true, live: { status: "won" } });
    // the creator is done, but the result is not settled yet and the times stay hidden
    const mid = await getChallengeWinner(env.deps.store, id, T0 + 1);
    expect(mid).toMatchObject({ found: true, settled: false, winner: null });
    const fast = await play(env, id, B);
    if (!fast.ok) throw new Error("move");
    expect(fast.challenge).toMatchObject({ status: "done", settled: true, winner: B, reason: "faster" });
    expect(fast.challenge!.players.every((p) => typeof p.seconds === "number")).toBe(true);
    expect(fast.live.board.cells.some((c) => c.mine)).toBe(true); // the full board once it is over
    expect(await getChallengeWinner(env.deps.store, id, T0 + 1)).toMatchObject({ found: true, settled: true, winner: B, reason: "faster" });
  });

  it("hides the other player's time until the result is settled", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(A) });
    await startChallenge(env.deps, { id, ...env.as(B) });
    const a = await play(env, id, A, { stepSeconds: 1 });
    if (!a.ok) throw new Error("move");
    expect(a.challenge!.settled).toBe(false);
    expect(a.challenge!.players.find((p) => p.role === "creator")).toMatchObject({ finished: true });
    expect(a.challenge!.players.find((p) => p.role === "creator")).not.toHaveProperty("seconds");
  });

  it("a mine loses to a clear, and two mines is a draw", async () => {
    const one = await setup(file());
    await startChallenge(one.env.deps, { id: one.id, ...one.env.as(A) });
    await startChallenge(one.env.deps, { id: one.id, ...one.env.as(B) });
    expect(await play(one.env, one.id, A, { lose: true })).toMatchObject({ ok: true, live: { status: "lost" } });
    const f = await play(one.env, one.id, B);
    expect(f.ok && f.challenge).toMatchObject({ settled: true, winner: B, reason: "opponent-lost" });

    const two = await setup(file());
    await startChallenge(two.env.deps, { id: two.id, ...two.env.as(A) });
    await startChallenge(two.env.deps, { id: two.id, ...two.env.as(B) });
    await play(two.env, two.id, A, { lose: true });
    const g = await play(two.env, two.id, B, { lose: true });
    expect(g.ok && g.challenge).toMatchObject({ settled: true, winner: null, reason: "draw" });
  });

  it("allows one try per player: a finished try cannot restart or change", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(A) });
    await play(env, id, A, { lose: true });
    const before = await env.deps.store.challengeEntries(id);
    const back = await startChallenge(env.deps, { id, ...env.as(A) });
    expect(back).toMatchObject({ ok: true, live: { status: "lost" } });
    const late = await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "reveal", idx: 1 } });
    expect(late).toMatchObject({ ok: true });
    expect(await env.deps.store.challengeEntries(id)).toEqual(before);
  });

  it("picks a running try back up after a refresh, clock unchanged", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(B) });
    await moveChallenge(env.deps, { id, ...env.as(B), move: { action: "reveal", idx: 0 } });
    env.advance(30);
    const again = await startChallenge(env.deps, { id, ...env.as(B) });
    if (!again.ok) throw new Error("start");
    expect(again.live.started).toBe(true);
    expect(again.live.elapsed).toBe(30);
  });

  it("keeps a third wallet out and refuses a move from someone who did not start", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(B) });
    expect(await startChallenge(env.deps, { id, ...env.as(C) })).toMatchObject({ ok: false, status: 409 });
    expect(await moveChallenge(env.deps, { id, ...env.as(C), move: { action: "reveal", idx: 0 } })).toMatchObject({ ok: false, status: 400 });
    expect(await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "reveal", idx: 0 } })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses bad ids, bad moves and bad signatures", async () => {
    const { env, id } = await setup(file());
    expect(await startChallenge(env.deps, { id: "../etc", ...env.as(A) })).toMatchObject({ ok: false, status: 404 });
    expect(await startChallenge(env.deps, { id: "0".repeat(12), ...env.as(A) })).toMatchObject({ ok: false, status: 404 });
    await startChallenge(env.deps, { id, ...env.as(A) });
    expect(await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "dig", idx: 0 } })).toMatchObject({ ok: false, status: 400 });
    expect(await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "reveal", idx: -1 } })).toMatchObject({ ok: false, status: 400 });
    expect(await moveChallenge({ ...env.deps, recover: async () => B }, { id, ...env.as(A), move: { action: "reveal", idx: 0 } })).toMatchObject({ ok: false, status: 401 });
  });
});

describe("expiry and forfeits", () => {
  const ch: Challenge = { id: "x", seed: "0x", tokenId: 1, date: "2026-10-20", creator: A, createdAt: T0, expiresAt: T0 + CHALLENGE_LIFE_MS };
  const done = (wallet: string, won: boolean, seconds: number, finishedAt: number) => ({ wallet, startedAt: T0, finishedAt, won, seconds, moves: 5 });

  it("is open until the link expires, then expired with no winner", () => {
    expect(challengeOutcome(ch, {}, T0 + 1000)).toMatchObject({ status: "open", settled: false });
    expect(challengeOutcome(ch, { creator: done(A, true, 9, T0 + 9000) }, T0 + CHALLENGE_LIFE_MS)).toMatchObject({ status: "open" });
    expect(challengeOutcome(ch, { creator: done(A, true, 9, T0 + 9000) }, T0 + CHALLENGE_LIFE_MS + 1)).toEqual({ status: "expired", settled: true, winner: null, reason: "expired" });
  });

  it("starting after expiry is refused", async () => {
    const { env, id } = await setup(file());
    env.advance(CHALLENGE_LIFE_MS / 1000 + 1);
    expect(await startChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: false, status: 410 });
  });

  it("a player who runs out of time loses to a finished clear", async () => {
    const e: ChallengeEntries = { creator: done(A, true, 50, T0 + 50_000), opponent: { wallet: B, startedAt: T0 } };
    expect(challengeOutcome(ch, e, T0 + RUN_LIMIT_MS)).toMatchObject({ status: "playing", settled: false });
    expect(challengeOutcome(ch, e, T0 + RUN_LIMIT_MS + 1)).toEqual({ status: "done", settled: true, winner: A, reason: "forfeit" });
  });

  it("a creator who never plays forfeits once the link has expired", () => {
    const e: ChallengeEntries = { opponent: done(B, true, 40, T0 + 40_000) };
    expect(challengeOutcome(ch, e, T0 + 5000)).toMatchObject({ status: "playing", settled: false });
    expect(challengeOutcome(ch, e, T0 + CHALLENGE_LIFE_MS + 1)).toMatchObject({ settled: true, winner: B, reason: "forfeit" });
  });

  it("a tie on seconds goes to whoever finished first", () => {
    const e: ChallengeEntries = { creator: done(A, true, 30, T0 + 31_000), opponent: done(B, true, 30, T0 + 30_000) };
    expect(challengeOutcome(ch, e, T0 + 60_000)).toMatchObject({ winner: B, reason: "faster" });
  });

  it("a move after the hour is refused", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(B) });
    env.advance(RUN_LIMIT_MS / 1000 + 5);
    expect(await moveChallenge(env.deps, { id, ...env.as(B), move: { action: "reveal", idx: 0 } })).toMatchObject({ ok: false, status: 410 });
  });
});

describe("reading the winner", () => {
  it("says not found, then not settled, then the winner", async () => {
    const { env, id } = await setup(file());
    expect(await getChallengeWinner(env.deps.store, "f".repeat(12))).toEqual({ found: false });
    expect(await getChallengeWinner(env.deps.store, id, T0)).toEqual({ found: true, settled: false, winner: null });
    await startChallenge(env.deps, { id, ...env.as(A) });
    await startChallenge(env.deps, { id, ...env.as(B) });
    await play(env, id, A, { stepSeconds: 1 });
    await play(env, id, B, { lose: true });
    expect(await getChallengeWinner(env.deps.store, id, T0)).toEqual({ found: true, settled: true, winner: A, reason: "opponent-lost" });
  });
});

describe("live progress", () => {
  it("shows each player's percent of safe tiles opened, and 100 once cleared", async () => {
    const { env, id } = await setup(file());
    await startChallenge(env.deps, { id, ...env.as(A) });
    await startChallenge(env.deps, { id, ...env.as(B) });
    expect(await challengeProgress(env.deps, id)).toEqual({ creator: 0, opponent: 0 });
    // one safe reveal each: a number between 0 and 100, never a hint about mines
    const ch = (await env.deps.store.challengeGet(id))!;
    const real = await env.deps.board(ch);
    const safe = real.cells.findIndex((c) => !c.mine);
    await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "reveal", idx: safe } });
    const p = await challengeProgress(env.deps, id);
    expect(p.creator!).toBeGreaterThan(0);
    expect(p.creator!).toBeLessThan(100);
    expect(p.opponent).toBe(0);
    await play(env, id, A);
    expect((await challengeProgress(env.deps, id)).creator).toBe(100);
  });
});

describe.each(stores)("%s store: cancelling a challenge", (_n, mk) => {
  it("lets only the maker close a link nobody has joined, and stops new players", async () => {
    const { env, id } = await setup(mk());
    expect(await cancelChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: false, status: 403 });
    const out = await cancelChallenge(env.deps, { id, ...env.as(A) });
    expect(out).toMatchObject({ ok: true, challenge: { status: "expired", settled: true, winner: null, reason: "cancelled", cancelled: true } });
    expect(await startChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: false, status: 410 });
    expect(await cancelChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: true });
  });

  it("refuses once a friend has taken the second seat", async () => {
    const { env, id } = await setup(mk());
    expect((await startChallenge(env.deps, { id, ...env.as(B) })).ok).toBe(true);
    expect(await cancelChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: false, status: 409 });
    expect((await getChallengeView(env.deps.store, id))?.cancelled).toBe(false);
  });
});

describe("live duel", () => {
  it("starts both players together after a countdown and shows boards without mines", async () => {
    const env = make(file());
    const made = await createChallenge(env.deps, { ...env.as(A), duel: true });
    if (!made.ok) throw new Error("create");
    const id = made.challenge.id;
    expect(made.challenge).toMatchObject({ duel: true, goAt: null });
    expect((await startChallenge(env.deps, { id, ...env.as(A) })).ok).toBe(true);
    const mv = (w: string) => moveChallenge(env.deps, { id, ...env.as(w), move: { action: "reveal", idx: 0 } });
    expect(await mv(A)).toMatchObject({ ok: false, status: 425 });
    const joined = await startChallenge(env.deps, { id, ...env.as(B) });
    if (!joined.ok) throw new Error("join");
    expect(joined.challenge.goAt).toBe(T0 + DUEL_COUNTDOWN_MS);
    expect(await mv(B)).toMatchObject({ ok: false, status: 425 });
    env.advance(DUEL_COUNTDOWN_MS / 1000 + 1);
    expect((await mv(B)).ok).toBe(true);
    const boards = await challengeBoards(env.deps, id);
    expect(boards.opponent?.state).toMatch(/playing|won|lost/);
    expect(boards.creator?.state).toBe("waiting");
    expect(boards.opponent?.revealed.some(Boolean)).toBe(true);
    const real = await env.deps.board((await env.deps.store.challengeGet(id))!);
    boards.opponent!.revealed.forEach((r, i) => { if (r) expect(real.cells[i].mine).toBe(false); });
  });

  it("does not need a countdown when it is not a duel", async () => {
    const { env, id } = await setup(file());
    expect((await startChallenge(env.deps, { id, ...env.as(A) })).ok).toBe(true);
    expect((await moveChallenge(env.deps, { id, ...env.as(A), move: { action: "reveal", idx: 0 } })).ok).toBe(true);
  });
});
