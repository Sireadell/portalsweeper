import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore, UpstashRecordStore, rankCotd, type CotdEntry, type RecordStore } from "./records";
import { portalOfDay, finishRanked, pickPortalOfDay, recentClears, startRanked, summarize, type CotdDeps } from "./cotd";
import { PORTAL_SUPPLY } from "./types";

// A tiny in-memory stand-in for the Upstash REST API: only the commands the store uses.
export function fakeUpstash() {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  const calls: unknown[][] = [];
  const run = (c: (string | number)[]): unknown => {
    const [op, key, ...a] = c.map(String);
    switch (op) {
      case "GET": return kv.get(key) ?? null;
      case "MGET": return [key, ...a].map((k) => kv.get(k) ?? null);
      case "SET":
        if (a[1] === "NX" && kv.has(key)) return null;
        kv.set(key, a[0]);
        return "OK";
      case "SADD": (sets.get(key) ?? sets.set(key, new Set()).get(key)!).add(a[0]); return 1;
      case "SMEMBERS": return [...(sets.get(key) ?? [])];
      case "HSETNX": {
        const h = hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
        if (h.has(a[0])) return 0;
        h.set(a[0], a[1]);
        return 1;
      }
      case "HSET": (hashes.get(key) ?? hashes.set(key, new Map()).get(key)!).set(a[0], a[1]); return 1;
      case "HGET": return hashes.get(key)?.get(a[0]) ?? null;
      case "HGETALL": return [...(hashes.get(key) ?? [])].flat();
      case "HDEL": return hashes.get(key)?.delete(a[0]) ? 1 : 0;
      default: throw new Error(`fake: ${op}`);
    }
  };
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    if (init.headers.Authorization !== "Bearer tok") return { ok: false, status: 401, json: async () => ({ error: "bad token" }) };
    const cmd = JSON.parse(init.body) as (string | number)[];
    calls.push([url, ...cmd]);
    return { ok: true, status: 200, json: async () => ({ result: run(cmd) }) };
  };
  return { fetchImpl, calls };
}

const win = (tokenId: number, date: string, seconds = 60) => ({ tokenId, date, won: true, seconds, moves: 10 });

const stores: [string, () => RecordStore][] = [
  ["file", () => new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"))],
  ["upstash (fake fetch)", () => new UpstashRecordStore("https://x.upstash.io/", "tok", fakeUpstash().fetchImpl)],
];

describe.each(stores)("%s store", (_n, make) => {
  it("keeps records, streaks and the one-per-day rule", async () => {
    const s = make();
    await s.submit(win(1, "2026-10-20", 90));
    await s.submit({ tokenId: 1, date: "2026-10-21", won: false, seconds: 5, moves: 2 });
    await s.submit(win(1, "2026-10-22", 45));
    expect(await s.getRecord(1)).toMatchObject({ plays: 3, wins: 2, bestSeconds: 45, currentStreak: 1, longestStreak: 1 });
    const again = await s.submit(win(1, "2026-10-22", 5));
    expect(again.ok).toBe(false);
    await s.submit(win(2, "2026-10-20"));
    await s.submit(win(2, "2026-10-21"));
    expect((await s.getRecord(2)).currentStreak).toBe(2);
    expect((await s.listRecords()).map((r) => r.tokenId).sort()).toEqual([1, 2]);
    expect((await s.getRecord(99)).plays).toBe(0);
  });

  it("handles the Portal of the day life cycle", async () => {
    const s = make();
    const e: CotdEntry = { date: "2026-10-20", wallet: "0xaa", tokenId: 5, startedAt: 1000 };
    expect((await s.cotdStart(e)).ok).toBe(true);
    expect((await s.cotdStart({ ...e, startedAt: 2000 })).ok).toBe(false);
    expect((await s.cotdFinish("2026-10-20", "0xbb", { won: true, seconds: 1, moves: 1, at: 5 })).ok).toBe(false);
    const f = await s.cotdFinish("2026-10-20", "0xaa", { won: true, seconds: 33.3, moves: 12, at: 5000 });
    expect(f.ok).toBe(true);
    expect((await s.cotdFinish("2026-10-20", "0xaa", { won: true, seconds: 1, moves: 1, at: 6000 })).ok).toBe(false);
    expect(await s.cotdEntry("2026-10-20", "0xaa")).toMatchObject({ won: true, seconds: 33.3, startedAt: 1000 });
    expect(await s.cotdEntries("2026-10-21")).toEqual([]);
  });
});

describe("upstash store details", () => {
  it("sends the bearer token to the base url and trims a trailing slash", async () => {
    const fake = fakeUpstash();
    await new UpstashRecordStore("https://x.upstash.io///", "tok", fake.fetchImpl).getRecord(3);
    expect(fake.calls[0]).toEqual(["https://x.upstash.io", "GET", "portal:rec:3"]);
  });

  it("throws on an error reply so a bad token is not silent", async () => {
    await expect(new UpstashRecordStore("https://x.upstash.io", "wrong", fakeUpstash().fetchImpl).getRecord(1)).rejects.toThrow(/Upstash/);
  });

  it("lets only one of two parallel submits for the same day count", async () => {
    const s = new UpstashRecordStore("https://x.upstash.io", "tok", fakeUpstash().fetchImpl);
    const [a, b] = await Promise.all([s.submit(win(4, "2026-10-20")), s.submit(win(4, "2026-10-20"))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("getStore picks by env", () => {
  it("uses Upstash when both vars are set, the file otherwise", async () => {
    const old = { u: process.env.UPSTASH_REDIS_REST_URL, t: process.env.UPSTASH_REDIS_REST_TOKEN };
    try {
      process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
      vi.resetModules();
      let mod = await import("./records");
      expect(mod.getStore()).toBeInstanceOf(mod.UpstashRecordStore);
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      vi.resetModules();
      mod = await import("./records");
      expect(mod.getStore()).toBeInstanceOf(mod.FileRecordStore);
    } finally {
      if (old.u === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = old.u;
      if (old.t === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = old.t;
    }
  });
});

describe("picking the Portal of the day", () => {
  beforeAll(() => { process.env.PORTAL_SALT_SECRET = "test-secret"; });

  it("is deterministic, in range, and changes with the date or commit", () => {
    const a = pickPortalOfDay("2026-10-20", "0xabc");
    expect(a).toBe(pickPortalOfDay("2026-10-20", "0xabc"));
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(PORTAL_SUPPLY);
    expect(pickPortalOfDay("2026-10-21", "0xabc")).not.toBe(a);
  });

  it("steps past Portals that are already taken", () => {
    const a = pickPortalOfDay("2026-10-20", "0xabc");
    const next = (a % PORTAL_SUPPLY) + 1;
    expect(pickPortalOfDay("2026-10-20", "0xabc", new Set([a]))).toBe(next);
    expect(pickPortalOfDay("2026-10-20", "0xabc", new Set([a, next]))).toBe((next % PORTAL_SUPPLY) + 1);
  });

  it("fixes the day's Portal once, skipping earlier wins and yesterday's Portal", async () => {
    const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"));
    const first = await portalOfDay(store, "2026-10-20");
    expect(await portalOfDay(store, "2026-10-20")).toBe(first);
    // a claim made today does not move today's Portal
    await store.claimLock({ tokenId: first, wallet: "0x" + "a".repeat(40), date: "2026-10-20", at: 0, status: "minted" });
    expect(await portalOfDay(store, "2026-10-20")).toBe(first);
    // tomorrow can never land on today's Portal
    expect(await portalOfDay(store, "2026-10-21")).not.toBe(first);
  });

  it("spreads over many Portals across a year", () => {
    const seen = new Set(Array.from({ length: 365 }, (_, i) => pickPortalOfDay(`d${i}`, "0x1")));
    expect(seen.size).toBeGreaterThan(220); // about 259 expected for 365 random picks from 500
  });
});

describe("ranked tries", () => {
  const T0 = Date.parse("2026-10-20T12:00:00Z");
  const wallet = "0x" + "a".repeat(40);
  const mk = (over: Partial<CotdDeps> = {}, store: RecordStore = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"))) => {
    let t = T0;
    const deps: CotdDeps = { store, now: () => t, recover: async () => wallet, ...over };
    return { deps, advance: (s: number) => { t += s * 1000; } };
  };
  const who = { address: wallet, signature: "0xsig" };

  beforeAll(() => { process.env.PORTAL_SALT_SECRET = "test-secret"; });

  it("rejects a bad signature and a mismatched signer", async () => {
    expect(await startRanked(mk({ recover: async () => { throw new Error("x"); } }).deps, who)).toMatchObject({ ok: false, status: 401 });
    expect(await startRanked(mk({ recover: async () => "0x" + "b".repeat(40) }).deps, who)).toMatchObject({ ok: false, status: 401 });
    expect(await startRanked(mk().deps, { address: "nope", signature: "x" })).toMatchObject({ ok: false, status: 400 });
  });

  it("allows one try per wallet and ranks the fastest first", async () => {
    const m = mk();
    const s1 = await startRanked(m.deps, who);
    expect(s1).toMatchObject({ ok: true });
    expect(s1.ok && s1.entry.tokenId).toBe(await portalOfDay(m.deps.store, "2026-10-20"));
    expect(await startRanked(m.deps, who)).toMatchObject({ ok: false, status: 409 });
    m.advance(40);
    const f = await finishRanked(m.deps, { ...who, date: "2026-10-20", won: true, seconds: 30, moves: 20 });
    expect(f).toMatchObject({ ok: true, rank: 1 });
    expect(await finishRanked(m.deps, { ...who, date: "2026-10-20", won: true, seconds: 1, moves: 1 })).toMatchObject({ ok: false, status: 409 });

    // a second, faster wallet takes rank 1
    const w2 = "0x" + "c".repeat(40);
    const m2 = { ...m.deps, recover: async () => w2 };
    await startRanked(m2, { address: w2, signature: "s" });
    m.advance(20);
    const f2 = await finishRanked(m2, { address: w2, signature: "s", date: "2026-10-20", won: true, seconds: 15, moves: 9 });
    expect(f2).toMatchObject({ ok: true, rank: 1 });
    const sum = await summarize(m.deps.store, new Date(T0 + 70_000), w2);
    expect(sum.leaderboard.map((r) => r.seconds)).toEqual([15, 30]);
    expect(sum.attempts).toBe(2);
    expect(sum.mine).toMatchObject({ finished: true, won: true, rank: 1 });
    expect(sum.nextUtc).toBe(Date.parse("2026-10-21T00:00:00Z"));
  });

  it("refuses a time longer than the server clock, an unstarted finish and a closed day", async () => {
    const m = mk();
    expect(await finishRanked(m.deps, { ...who, date: "2026-10-20", won: true, seconds: 5, moves: 1 })).toMatchObject({ ok: false, status: 400 });
    await startRanked(m.deps, who);
    m.advance(10);
    expect(await finishRanked(m.deps, { ...who, date: "2026-10-20", won: true, seconds: 500, moves: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await finishRanked(m.deps, { ...who, date: "2026-10-01", won: true, seconds: 5, moves: 1 })).toMatchObject({ ok: false, status: 400 });
  });

  it("does not rank a loss and shows yesterday's winner", async () => {
    const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"));
    await store.cotdStart({ date: "2026-10-19", wallet, tokenId: 9, startedAt: 1 });
    await store.cotdFinish("2026-10-19", wallet, { won: true, seconds: 41, moves: 3, at: 2 });
    const m = mk({}, store);
    await startRanked(m.deps, who);
    m.advance(5);
    const f = await finishRanked(m.deps, { ...who, date: "2026-10-20", won: false, seconds: 4, moves: 2 });
    expect(f).toMatchObject({ ok: true, rank: null });
    const sum = await summarize(store, new Date(T0 + 6000));
    expect(sum.leaderboard).toEqual([]);
    expect(sum.yesterday.winner?.seconds).toBe(41);
    expect(rankCotd(await store.cotdEntries("2026-10-20"))).toEqual([]);
  });
});

describe("cleared today and recent clears", () => {
  const e = (wallet: string, won: boolean | undefined, seconds: number | undefined, finishedAt?: number): CotdEntry => ({
    date: "2026-10-20", wallet, tokenId: 1, startedAt: 1, won, seconds, finishedAt,
  });
  it("counts wins only and lists the newest first", () => {
    const list = [e("0xaaaaaaaa11", true, 40, 100), e("0xbbbbbbbb22", false, 9, 200), e("0xcccccccc33", true, 30, 300), e("0xdddddddd44", undefined, undefined)];
    const r = recentClears(list);
    expect(r.map((x) => x.seconds)).toEqual([30, 40]);
    expect(recentClears(list, 1)).toHaveLength(1);
  });
  it("summarize reports zero clears without failing, and leaves unranked tries out", async () => {
    const s = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "portal-")), "r.json"));
    const sum = await summarize(s, new Date("2026-10-20T10:00:00Z"));
    expect(sum.cleared).toBe(0);
    expect(sum.recent).toEqual([]);
    expect(sum.attempts).toBe(0);
  });
});
