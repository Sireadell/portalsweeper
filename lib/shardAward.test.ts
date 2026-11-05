import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore, type CotdEntry } from "./records";
import { MemoryKv } from "./shardKv";
import { awardShardDay, planPlaces, readDayState, recentAwards, burnedKey, MIN_SECONDS_PER_SAFE_TILE, SHARD_SUPPLY_CAP, MAX_SHARD_PER_DAY, SHARD_PRIZES, type AwardRow, type AwardShardDeps } from "./shardAward";
import { portalOfDay } from "./cotd";

const D = "2026-11-06";
const w = (c: string) => "0x" + c.repeat(40);
const [A, B, C, E, F] = [w("a"), w("b"), w("c"), w("d"), w("e")];

function setup(opts: { tiles?: number; history?: (wallet: string) => boolean; ledger?: "ok" | "none" | "other" | "off"; supply?: number } = {}) {
  const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "shard-")), "r.json"));
  const kv = new MemoryKv();
  const sent: { date: string; rows: AwardRow[]; portal: number | null }[] = [];
  const owners = new Map<number, string>();
  let fail: string | null = null;
  const deps: AwardShardDeps = {
    store,
    kv,
    now: () => 5,
    safeTiles: async () => opts.tiles ?? 50,
    moves: async (e) => [{ action: "reveal", idx: e.seconds ?? 0, t: 1 }],
    playedBefore: async (wallet) => (opts.history ? opts.history(wallet) : true),
    portalOwner: async (id) => owners.get(id) ?? null,
    shardSupply: async () => opts.supply ?? 0,
    send: async (o) => {
      if (fail) throw new Error(fail);
      sent.push(o);
      return { txHash: "0xaward" + sent.length, block: 10 };
    },
  };
  if (opts.ledger && opts.ledger !== "off") {
    let held: string | null = opts.ledger === "other" ? w("9") : null;
    deps.ledgerWinner = async () => held;
    deps.recordWinner = async (_d, _t, e) => {
      if (opts.ledger === "ok") held = e.wallet;
      return "0xledger";
    };
  }
  return { store, kv, deps, sent, owners, setFail: (m: string | null) => (fail = m) };
}

async function clear(store: FileRecordStore, wallet: string, seconds: number, won = true, date = D) {
  await store.cotdStart({ date, wallet, tokenId: 1, startedAt: 0 });
  await store.cotdFinish(date, wallet, { won, seconds, moves: 10, at: seconds * 1000 });
}

beforeAll(() => {
  process.env.PORTAL_SALT_SECRET = "test-secret";
});

describe("prize maths", () => {
  it("pays 10, 4 and 2 and never more than 16 a day", () => {
    expect([...SHARD_PRIZES]).toEqual([10, 4, 2]);
    expect(SHARD_PRIZES.reduce((a, b) => a + b, 0)).toBe(MAX_SHARD_PER_DAY);
  });
});

describe("planPlaces", () => {
  const e = (wallet: string, seconds: number): CotdEntry => ({ date: D, wallet, tokenId: 1, startedAt: 0, finishedAt: 1, won: true, seconds });
  it("holds a clear faster than 0.3 s a safe tile and moves the next one up", async () => {
    const ranked = [e(A, 5), e(B, 20), e(C, 30)]; // 5 s on 50 tiles is 0.1 s a tile
    const p = await planPlaces(ranked, D, { safeTiles: async () => 50, hasHistory: async () => true }, { waiveHistory: false });
    expect(p.held.map((h) => [h.wallet, h.reason])).toEqual([[A, "too-fast"]]);
    expect(p.paid.map((x) => [x.entry.wallet, x.place, x.amount])).toEqual([[B, 1, 10], [C, 2, 4]]);
  });
  it("pays a clear exactly at the limit", async () => {
    const p = await planPlaces([e(A, 50 * MIN_SECONDS_PER_SAFE_TILE)], D, { safeTiles: async () => 50, hasHistory: async () => true }, { waiveHistory: false });
    expect(p.paid).toHaveLength(1);
    expect(p.held).toHaveLength(0);
  });
  it("needs one earlier day of ranked play, unless waived", async () => {
    const ranked = [e(A, 20), e(B, 30)];
    const look = { safeTiles: async () => 50, hasHistory: async (x: string) => x === B };
    const strict = await planPlaces(ranked, D, look, { waiveHistory: false });
    expect(strict.held.map((h) => [h.wallet, h.reason])).toEqual([[A, "no-history"]]);
    expect(strict.paid.map((x) => x.entry.wallet)).toEqual([B]);
    const waived = await planPlaces(ranked, D, look, { waiveHistory: true });
    expect(waived.paid.map((x) => x.entry.wallet)).toEqual([A, B]);
  });
  it("pays at most three places", async () => {
    const ranked = [e(A, 20), e(B, 21), e(C, 22), e(E, 23), e(F, 24)];
    const p = await planPlaces(ranked, D, { safeTiles: async () => 50, hasHistory: async () => true }, { waiveHistory: false });
    expect(p.paid.map((x) => x.amount)).toEqual([10, 4, 2]);
  });
});

describe("awardShardDay", () => {
  it("pays the top three in one transaction with a fingerprint each", async () => {
    const t = setup();
    for (const [x, s] of [[A, 30], [B, 20], [C, 25], [E, 40]] as const) await clear(t.store, x, s);
    const out = await awardShardDay(t.deps, D);
    expect(out.status).toBe("paid");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].rows.map((r) => [r.wallet, r.place, r.amount])).toEqual([[B, 1, 10], [C, 2, 4], [A, 3, 2]]);
    expect(t.sent[0].rows.every((r) => /^0x[0-9a-f]{64}$/.test(r.fingerprint))).toBe(true);
    expect(t.sent[0].portal).toBeNull();
    expect((await readDayState(t.kv, D))?.status).toBe("done");
    expect((await recentAwards(t.kv))[0].txHash).toBe("0xaward1");
  });

  it("never pays the same day twice", async () => {
    const t = setup();
    await clear(t.store, A, 30);
    await awardShardDay(t.deps, D);
    const again = await awardShardDay(t.deps, D);
    expect(again.status).toBe("already");
    expect(t.sent).toHaveLength(1);
  });

  it("two runs at the same moment send once", async () => {
    const t = setup();
    await clear(t.store, A, 30);
    const [x, y] = await Promise.all([awardShardDay(t.deps, D), awardShardDay(t.deps, D)]);
    expect(t.sent).toHaveLength(1);
    expect([x.status, y.status]).toContain("paid");
  });

  it("does nothing when nobody cleared", async () => {
    const t = setup();
    await clear(t.store, A, 30, false);
    expect(await awardShardDay(t.deps, D)).toEqual({ status: "no-winner", date: D });
    expect(t.sent).toHaveLength(0);
  });

  it("a failed send can be retried, a paid one cannot", async () => {
    const t = setup();
    await clear(t.store, A, 30);
    t.setFail("assets.BadMetadata");
    expect((await awardShardDay(t.deps, D)).status).toBe("failed");
    t.setFail(null);
    expect((await awardShardDay(t.deps, D)).status).toBe("paid");
    expect(t.sent).toHaveLength(1);
  });

  it("a timeout is not retried by itself, because the first send may have landed", async () => {
    const t = setup();
    await clear(t.store, A, 30);
    t.setFail("Send timed out waiting for a block.");
    await awardShardDay(t.deps, D);
    t.setFail(null);
    expect((await awardShardDay(t.deps, D)).status).toBe("busy");
    expect(t.sent).toHaveLength(0);
  });

  it("holds first place when the ledger holds someone else, and still pays the others", async () => {
    const t = setup({ ledger: "other" });
    await clear(t.store, A, 20);
    await clear(t.store, B, 30);
    const out = await awardShardDay(t.deps, D);
    expect(out.status).toBe("paid");
    expect(t.sent[0].rows.map((r) => [r.wallet, r.place, r.amount])).toEqual([[B, 2, 4]]);
    const st = await readDayState(t.kv, D);
    expect(st?.held.map((h) => [h.wallet, h.reason])).toEqual([[A, "ledger-mismatch"]]);
  });

  it("holds first place when the ledger has nothing for the day", async () => {
    const t = setup({ ledger: "none" });
    await clear(t.store, A, 20);
    const out = await awardShardDay(t.deps, D);
    expect(out.status).toBe("nothing-to-pay");
    expect(t.sent).toHaveLength(0);
  });

  it("pays first place when the ledger records the same wallet", async () => {
    const t = setup({ ledger: "ok" });
    await clear(t.store, A, 20);
    expect((await awardShardDay(t.deps, D)).status).toBe("paid");
    expect(t.sent[0].rows[0].wallet).toBe(A);
  });

  it("founding day pays SHARD only unless FOUNDING_PORTAL is on", async () => {
    const t = setup({ history: () => false });
    const d = "2026-11-05";
    await clear(t.store, A, 20, true, d);
    await awardShardDay(t.deps, d);
    expect(t.sent[0].portal).toBeNull();
    expect(t.sent[0].rows[0]).toMatchObject({ wallet: A, amount: 10 });
  });

  it("founding day waives history and sends the Portal with the winner", async () => {
    process.env.FOUNDING_PORTAL = "1";
    const t = setup({ history: () => false });
    const d = "2026-11-05";
    await clear(t.store, A, 20, true, d);
    const out = await awardShardDay(t.deps, d);
    expect(out.status).toBe("paid");
    const id = await portalOfDay(t.store, d);
    expect(t.sent[0].portal).toBe(id);
    expect(t.sent[0].rows[0]).toMatchObject({ wallet: A, amount: 10, portal: id });
    expect((await t.store.claimGet(id))?.wallet).toBe(A);
    delete process.env.FOUNDING_PORTAL;
  });

  it("founding day skips a Portal id that is already taken but still pays SHARD", async () => {
    process.env.FOUNDING_PORTAL = "1";
    const t = setup({ history: () => false });
    const d = "2026-11-05";
    await clear(t.store, A, 20, true, d);
    t.owners.set(await portalOfDay(t.store, d), "someone");
    await awardShardDay(t.deps, d);
    expect(t.sent[0].portal).toBeNull();
    expect((await readDayState(t.kv, d))?.portalSkipped).toMatch(/already owned/);
    delete process.env.FOUNDING_PORTAL;
  });

  it("later days pay SHARD only and need history", async () => {
    const t = setup({ history: () => false });
    await clear(t.store, A, 20);
    const out = await awardShardDay(t.deps, D);
    expect(out.status).toBe("nothing-to-pay");
    expect(t.sent).toHaveLength(0);
  });

  it("holds awards that would pass the 50,000 cap, and everything below them", async () => {
    const t = setup({ supply: SHARD_SUPPLY_CAP - 12 });
    for (const [x, s] of [[A, 20], [B, 30], [C, 40]] as const) await clear(t.store, x, s);
    await awardShardDay(t.deps, D);
    expect(t.sent[0].rows.map((r) => r.amount)).toEqual([10]);
    expect((await readDayState(t.kv, D))?.held.map((h) => h.reason)).toEqual(["supply-cap", "supply-cap"]);
  });

  it("counts redeem burns as already issued", async () => {
    const t = setup({ supply: SHARD_SUPPLY_CAP - 100 });
    await t.kv.set(burnedKey, "100");
    await clear(t.store, A, 20);
    expect((await awardShardDay(t.deps, D)).status).toBe("nothing-to-pay");
  });
});
