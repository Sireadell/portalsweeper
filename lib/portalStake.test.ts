import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import { createChallenge, moveChallenge, resolveChallengeStake, startChallenge, cancelChallenge, CHALLENGE_LIFE_MS, type ChallengeDeps } from "./challenge";
import { generateBoard } from "./engine";
import { getPortalMeta } from "./chain";
import { replayLog } from "./live";
import { MemoryStakeStore, lockPortal, lockStake, type StakeChain, type StakeDeps } from "./stakes";
import { payoutPlan, portalPayoutNote } from "./portalStake";
import { stakeView } from "./challengeStakes";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const T0 = Date.parse("2026-11-05T12:00:00Z");
const h = (n: number) => "0x" + n.toString(16).padStart(64, "0");

// Fake chain: which Portals sit with the escrow wallet, which lock transactions are real, and the batches it sent.
function setup() {
  let t = T0;
  let signer = A;
  const held = new Set<number>();
  const batches: { note: string; moves: { portal: number; to: string }[] }[] = [];
  const goodTx = new Map<string, { wallet: string; portal: number }>();
  const chain: StakeChain = {
    escrowAddress: () => "0xescrow",
    getTransfer: async () => null,
    send: async () => ({ txHash: h(1) }),
    portalEscrowAddress: () => "0xescrow",
    portalHeld: async (p) => held.has(p),
    verifyPortalLock: async (wallet, portal, tx) => {
      const g = goodTx.get(tx.toLowerCase());
      if (!g) return { ok: false, error: "Transaction not found yet. Wait a few seconds and try again." };
      if (g.wallet !== wallet) return { ok: false, error: "That transfer came from a different wallet." };
      if (g.portal !== portal) return { ok: false, error: "That transaction does not move that Portal." };
      return held.has(portal) ? { ok: true } : { ok: false, error: "The escrow wallet does not hold it." };
    },
    payoutPortals: async (note, moves) => {
      batches.push({ note, moves });
      for (const m of moves) held.delete(m.portal);
      return { txHash: h(900 + batches.length), block: 1000 + batches.length };
    },
  };
  const stakes: StakeDeps = { store: new MemoryStakeStore(), chain, now: () => t };
  const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "pstake-")), "r.json"));
  const deps: ChallengeDeps = { store, now: () => t, recover: async () => signer, board: async (c) => generateBoard(await getPortalMeta(c.tokenId), c.date, c.seed), stakes };
  const as = (w: string) => { signer = w; return { address: w, signature: "0xsig" }; };
  // A player moves their Portal into escrow with transaction number n.
  const move = (n: number, wallet: string, portal: number) => { held.add(portal); goodTx.set(h(n), { wallet, portal }); };
  return { deps, stakes, batches, held, as, move, advance: (s: number) => { t += s * 1000; } };
}
type Env = ReturnType<typeof setup>;

async function make(env: Env) {
  const made = await createChallenge(env.deps, { ...env.as(A), stakePortal: true, duel: false });
  if (!made.ok) throw new Error(made.error);
  return made.challenge.id;
}
async function lockBoth(env: Env, id: string) {
  env.move(1, A, 104);
  env.move(2, B, 103);
  await lockPortal(env.stakes, id, A, 104, h(1));
  await lockPortal(env.stakes, id, B, 103, h(2));
}
async function play(env: Env, id: string, w: string, lose = false) {
  const ch = (await env.deps.store.challengeGet(id))!;
  const real = await env.deps.board(ch);
  for (let n = 0; n < 500; n++) {
    const g = replayLog(real, await env.deps.store.movesGet(`challenge:${id}:${w}`));
    const pick = g.started && lose ? g.board.cells.findIndex((c, i) => c.mine && !g.flagged[i] && !g.revealed[i]) : g.board.cells.findIndex((c, i) => !c.mine && !g.revealed[i]);
    env.advance(1);
    const out = await moveChallenge(env.deps, { id, ...env.as(w), move: { action: "reveal", idx: pick } });
    if (!out.ok) return out;
    if (out.live.status === "won" || out.live.status === "lost") return out;
  }
  throw new Error("game did not end");
}

beforeAll(() => { process.env.PORTAL_SALT_SECRET = "test-secret"; });

describe("payout plan", () => {
  it("gives both Portals to the winner, one back each otherwise", () => {
    const e = [{ wallet: A, portal: 104 }, { wallet: B, portal: 103 }];
    expect(payoutPlan(e, { kind: "win", winner: B })).toEqual([{ portal: 104, to: B }, { portal: 103, to: B }]);
    expect(payoutPlan(e, { kind: "draw" })).toEqual([{ portal: 104, to: A }, { portal: 103, to: B }]);
    expect(payoutPlan([e[0]], { kind: "cancel" })).toEqual([{ portal: 104, to: A }]);
    expect(() => payoutPlan(e, { kind: "win", winner: C })).toThrow(/not a player/);
  });
  it("writes a short note", () => {
    expect(portalPayoutNote("abc123", "win", A)).toContain("win");
    expect(portalPayoutNote("abc123", "cancel").length).toBeLessThanOrEqual(120);
  });
});

describe("Portal stakes in a race", () => {
  it("both stake a Portal, the winner gets both in one batch", async () => {
    const env = setup();
    const id = await make(env);
    expect(await env.stakes.store.get(id)).toMatchObject({ asset: "portal", amountWei: "0", status: "open" });
    expect(await startChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: false, status: 403 });
    await lockBoth(env, id);
    expect(await startChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: true });
    expect(await startChallenge(env.deps, { id, ...env.as(B) })).toMatchObject({ ok: true });
    await play(env, id, A);
    expect(env.batches).toHaveLength(0);
    await play(env, id, B, true);
    expect(env.batches).toHaveLength(1);
    expect(env.batches[0].moves).toEqual([{ portal: 104, to: A }, { portal: 103, to: A }]);
    await resolveChallengeStake(env.deps, id);
    expect(env.batches).toHaveLength(1); // not paid twice
    const rec = (await env.stakes.store.get(id))!;
    expect(rec).toMatchObject({ status: "settled", winner: A });
    expect(stakeView(rec, "0xescrow")).toMatchObject({ asset: "portal", note: expect.stringMatching(/Trusted custody/) });
  });

  it("refuses to seat anyone if a staked Portal left escrow", async () => {
    const env = setup();
    const id = await make(env);
    await lockBoth(env, id);
    env.held.delete(103);
    expect(await startChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/no longer held/) });
  });

  it("returns a lone Portal when the creator cancels", async () => {
    const env = setup();
    const id = await make(env);
    env.move(1, A, 104);
    await lockPortal(env.stakes, id, A, 104, h(1));
    expect(await cancelChallenge(env.deps, { id, ...env.as(A) })).toMatchObject({ ok: true });
    expect(env.batches).toEqual([{ note: expect.stringContaining("cancel"), moves: [{ portal: 104, to: A }] }]);
    expect(await env.stakes.store.get(id)).toMatchObject({ status: "refunded" });
  });

  it("returns a lone Portal when the link expires with no second player", async () => {
    const env = setup();
    const id = await make(env);
    env.move(1, A, 104);
    await lockPortal(env.stakes, id, A, 104, h(1));
    env.advance(CHALLENGE_LIFE_MS / 1000 + 5);
    await resolveChallengeStake(env.deps, id);
    expect(env.batches[0].moves).toEqual([{ portal: 104, to: A }]);
  });

  it("settles one batch when one player never plays", async () => {
    const env = setup();
    const id = await make(env);
    await lockBoth(env, id);
    await startChallenge(env.deps, { id, ...env.as(A) });
    await play(env, id, A, true);
    env.advance(CHALLENGE_LIFE_MS / 1000 + 5);
    await resolveChallengeStake(env.deps, id);
    expect(env.batches).toHaveLength(1);
    expect(["settled", "refunded"]).toContain((await env.stakes.store.get(id))!.status);
  });

  it("rejects bad locks", async () => {
    const env = setup();
    const id = await make(env);
    env.move(1, A, 104);
    await expect(lockPortal(env.stakes, id, B, 104, h(1))).rejects.toThrow(/different wallet/);
    await expect(lockPortal(env.stakes, id, A, 104, h(77))).rejects.toThrow(/not found yet/);
    await expect(lockPortal(env.stakes, id, A, 0, h(1))).rejects.toThrow(/Portal must be/);
    await lockPortal(env.stakes, id, A, 104, h(1));
    await lockPortal(env.stakes, id, A, 104, h(1)); // safe to repeat
    env.move(2, B, 104);
    await expect(lockPortal(env.stakes, id, B, 104, h(2))).rejects.toThrow(/already staked/);
    env.move(3, B, 103);
    await expect(lockPortal(env.stakes, id, B, 103, h(1))).rejects.toThrow(/different wallet|already backs/);
    await expect(lockStake(env.stakes, id, B, h(3))).rejects.toThrow(/stakes a Portal/);
    await lockPortal(env.stakes, id, B, 103, h(3));
    env.move(4, C, 102);
    await expect(lockPortal(env.stakes, id, C, 102, h(4))).rejects.toThrow(/no longer open|already locked/);
  });

  it("does not accept a Portal lock on a tPOT stake", async () => {
    const env = setup();
    const made = await createChallenge(env.deps, { ...env.as(A), stakeTpot: "0.1" });
    if (!made.ok) throw new Error(made.error);
    env.move(1, A, 104);
    await expect(lockPortal(env.stakes, made.challenge.id, A, 104, h(1))).rejects.toThrow(/does not stake a Portal/);
  });

  it("refuses a tPOT and a Portal stake at once", async () => {
    const env = setup();
    expect(await createChallenge(env.deps, { ...env.as(A), stakePortal: true, stakeTpot: "0.1" })).toMatchObject({ ok: false, status: 400 });
  });
});
