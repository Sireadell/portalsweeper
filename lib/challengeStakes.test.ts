import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import {
  CHALLENGE_LIFE_MS, createChallenge, getChallengeView, moveChallenge, resolveChallengeStake, startChallenge, type ChallengeDeps,
} from "./challenge";
import { generateBoard } from "./engine";
import { getPortalMeta } from "./chain";
import { replayLog } from "./live";
import { MemoryStakeStore, lockStake, parseTpot, type ChainTransfer, type StakeChain, type StakeDeps } from "./stakes";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const ESCROW = "0x00000000000000000000000000000000000e5c20";
const T0 = Date.parse("2026-10-20T12:00:00Z");
const h = (n: number) => "0x" + n.toString(16).padStart(64, "0");

// Everything here runs against a fake chain: no real transaction, no keys.
function setup(stakesOn = true) {
  let t = T0;
  let signer = A;
  const transfers = new Map<string, ChainTransfer>();
  const sent: { to: string; wei: bigint }[] = [];
  const chain: StakeChain = {
    escrowAddress: () => ESCROW,
    getTransfer: async (tx) => transfers.get(tx.toLowerCase()) ?? null,
    send: async (to, wei) => { sent.push({ to, wei }); return { txHash: h(900 + sent.length) }; },
  };
  const stakes: StakeDeps = { store: new MemoryStakeStore(), chain, now: () => t };
  const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"));
  const deps: ChallengeDeps = {
    store, now: () => t, recover: async () => signer,
    board: async (c) => generateBoard(await getPortalMeta(c.tokenId), c.date, c.seed),
    stakes: stakesOn ? stakes : null,
  };
  const as = (w: string) => { signer = w; return { address: w, signature: "0xsig" }; };
  const pay = (n: number, from: string, tpot = "0.1") => transfers.set(h(n), { from, to: ESCROW, valueWei: parseTpot(tpot), ok: true });
  return { deps, stakes, chain, sent, as, pay, advance: (s: number) => { t += s * 1000; } };
}
type Env = ReturnType<typeof setup>;

async function play(env: Env, id: string, w: string, lose = false) {
  const ch = (await env.deps.store.challengeGet(id))!;
  const real = await env.deps.board(ch);
  for (let n = 0; n < 500; n++) {
    const g = replayLog(real, await env.deps.store.movesGet(`challenge:${id}:${w}`));
    const pick = g.started && lose
      ? g.board.cells.findIndex((c, i) => c.mine && !g.flagged[i] && !g.revealed[i])
      : g.board.cells.findIndex((c, i) => !c.mine && !g.revealed[i]);
    env.advance(1);
    const out = await moveChallenge(env.deps, { id, ...env.as(w), move: { action: "reveal", idx: pick } });
    if (!out.ok) return out;
    if (out.live.status === "won" || out.live.status === "lost") return out;
  }
  throw new Error("game did not end");
}

async function staked(env: Env, tpot = "0.1") {
  const made = await createChallenge(env.deps, { ...env.as(A), stakeTpot: tpot });
  if (!made.ok) throw new Error(made.error);
  return made.challenge.id;
}
async function lockBoth(env: Env, id: string) {
  env.pay(1, A);
  env.pay(2, B);
  await lockStake(env.stakes, id, A, h(1));
  await lockStake(env.stakes, id, B, h(2));
}
async function bothSit(env: Env, id: string) {
  await startChallenge(env.deps, { id, ...env.as(A) });
  await startChallenge(env.deps, { id, ...env.as(B) });
}

beforeAll(() => { process.env.PORTAL_SALT_SECRET = "test-secret"; });

describe("a staked challenge", () => {
  it("runs from create to a single payout", async () => {
    const env = setup();
    const id = await staked(env);
    expect(await env.stakes.store.get(id)).toMatchObject({ creator: A, status: "open", amountWei: parseTpot("0.1").toString() });
    await lockBoth(env, id);
    expect(await startChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: true });
    expect(await startChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: true });
    await play(env, id, A);
    expect(env.sent).toHaveLength(0); // not settled while B is still playing
    await play(env, id, B, true); // B hits a mine, A wins
    expect(env.sent).toEqual([{ to: A, wei: parseTpot("0.2") }]);
    await resolveChallengeStake(env.deps, id);
    await resolveChallengeStake(env.deps, id);
    expect(env.sent).toHaveLength(1);
    expect(await env.stakes.store.get(id)).toMatchObject({ status: "settled", winner: A });
  });

  it("pays when a read first sees the result, even when two reads race", async () => {
    const env = setup();
    const id = await staked(env);
    await lockBoth(env, id);
    await bothSit(env, id);
    await play(env, id, A);
    env.advance(3601); // B never finishes and the hour runs out
    const out = await Promise.all([resolveChallengeStake(env.deps, id), resolveChallengeStake(env.deps, id)]);
    expect(out.every((r) => r !== null)).toBe(true);
    expect(env.sent).toEqual([{ to: A, wei: parseTpot("0.2") }]);
  });

  it("keeps everyone out until both stakes are locked, and keeps strangers out", async () => {
    const env = setup();
    const id = await staked(env);
    expect(await startChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/Lock your stake/) });
    env.pay(1, A);
    await lockStake(env.stakes, id, A, h(1));
    expect(await startChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/other player/) });
    expect(await startChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: false, status: 403 });
    env.pay(2, B);
    await lockStake(env.stakes, id, B, h(2));
    expect(await startChallenge(env.deps, { id, ...env.as(C) })).toMatchObject({ ok: false, status: 403 });
    expect(await startChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: true });
  });

  it("refunds a draw", async () => {
    const env = setup();
    const id = await staked(env);
    await lockBoth(env, id);
    await bothSit(env, id);
    await play(env, id, A, true);
    await play(env, id, B, true);
    expect(env.sent).toEqual([{ to: A, wei: parseTpot("0.1") }, { to: B, wei: parseTpot("0.1") }]);
    expect(await env.stakes.store.get(id)).toMatchObject({ status: "refunded" });
  });

  it("refunds the one who locked when the link expires with no opponent", async () => {
    const env = setup();
    const id = await staked(env);
    env.pay(1, A);
    await lockStake(env.stakes, id, A, h(1));
    expect(await resolveChallengeStake(env.deps, id)).toMatchObject({ status: "open" }); // still waiting
    expect(env.sent).toHaveLength(0);
    env.advance(CHALLENGE_LIFE_MS / 1000 + 1);
    expect(await resolveChallengeStake(env.deps, id)).toMatchObject({ status: "refunded" });
    expect(env.sent).toEqual([{ to: A, wei: parseTpot("0.1") }]);
    await resolveChallengeStake(env.deps, id);
    expect(env.sent).toHaveLength(1);
  });

  it("closes an expired stake with nothing to send when nobody locked", async () => {
    const env = setup();
    const id = await staked(env);
    env.advance(CHALLENGE_LIFE_MS / 1000 + 1);
    expect(await resolveChallengeStake(env.deps, id)).toMatchObject({ status: "refunded", refundTxs: [] });
    expect(env.sent).toHaveLength(0);
  });

  it("retries a failed payout and still pays once", async () => {
    const env = setup();
    const id = await staked(env);
    await lockBoth(env, id);
    await bothSit(env, id);
    const real = env.chain.send;
    let fail = true;
    env.chain.send = async (to, wei) => {
      if (fail) throw new Error("rpc down");
      return real(to, wei);
    };
    await play(env, id, A);
    await play(env, id, B, true); // the payout fails quietly inside the move
    expect(env.sent).toHaveLength(0);
    await expect(resolveChallengeStake(env.deps, id)).rejects.toThrow(/rpc down/);
    fail = false;
    expect(await resolveChallengeStake(env.deps, id)).toMatchObject({ status: "settled" });
    await resolveChallengeStake(env.deps, id);
    expect(env.sent).toHaveLength(1);
  });

  it("lists live stakes for the timer until they are paid", async () => {
    const env = setup();
    const id = await staked(env);
    expect(await env.stakes.store.listLive()).toEqual([id]);
    env.advance(CHALLENGE_LIFE_MS / 1000 + 1);
    await resolveChallengeStake(env.deps, id);
    expect(await env.stakes.store.listLive()).toEqual([]);
  });

  it("rejects a bad stake amount before making the challenge", async () => {
    const env = setup();
    expect(await createChallenge(env.deps, { ...env.as(A), stakeTpot: "5" })).toMatchObject({ ok: false, status: 400 });
    expect(await createChallenge(env.deps, { ...env.as(A), stakeTpot: "abc" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("with stakes off or none asked for", () => {
  it("ignores a stake and plays as before", async () => {
    const env = setup(false);
    const made = await createChallenge(env.deps, { ...env.as(A), stakeTpot: "0.1" });
    if (!made.ok) throw new Error(made.error);
    const id = made.challenge.id;
    expect(await env.stakes.store.get(id)).toBeNull();
    await bothSit(env, id);
    await play(env, id, A);
    await play(env, id, B, true);
    expect(await resolveChallengeStake(env.deps, id)).toBeNull();
    expect(env.sent).toHaveLength(0);
    expect((await getChallengeView(env.deps.store, id, env.deps.now!()))?.settled).toBe(true);
  });

  it("makes no stake for none, 0 or empty", async () => {
    const env = setup();
    for (const none of [undefined, "0", ""]) {
      const made = await createChallenge(env.deps, { ...env.as(A), stakeTpot: none });
      if (!made.ok) throw new Error(made.error);
      expect(await env.stakes.store.get(made.challenge.id)).toBeNull();
      expect(await startChallenge(env.deps, { id: made.challenge.id, ...env.as(A) })).toMatchObject({ ok: true });
    }
  });
});
