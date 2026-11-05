import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import {
  BACK_MAX_WEI, MAX_BACKERS, MemoryPoolStore, REFUND_AFTER_MS, backEvent, eventView, openEvent, resolveEvent, splitPot,
  type PoolDeps,
} from "./predictions";
import { poolNote, weiToNative, type Payment, type PoolChain } from "./poolPayout";
import { parseTpot } from "./stakes";

const ESCROW = "0x00000000000000000000000000000000000e5c20";
const P1 = "0x" + "a1".repeat(20); // race creator
const P2 = "0x" + "b2".repeat(20); // race opponent
const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const h = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const T0 = Date.parse("2026-11-05T12:00:00Z");
const ID = "abcdef012345";

function setup(opts: { batchFails?: "refused" | "unknown" } = {}) {
  let t = T0;
  const races = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "pool-")), "r.json"));
  const transfers = new Map<string, { from: string; to: string; valueWei: bigint; ok: boolean }>();
  const batches: { payments: Payment[]; note: string }[] = [];
  const singles: Payment[][] = [];
  const chain: PoolChain = {
    escrowAddress: () => ESCROW,
    getTransfer: async (tx) => transfers.get(tx.toLowerCase()) ?? null,
    payBatch: async (payments, note) => {
      if (opts.batchFails === "refused") throw new Error("The node refused the payout batch: x");
      if (opts.batchFails === "unknown") throw new Error("timeout");
      batches.push({ payments, note });
      return { txHash: h(900 + batches.length), block: 77 };
    },
    payEach: async (payments) => {
      singles.push(payments);
      return payments.map((_, i) => ({ txHash: h(800 + i), block: 78 }));
    },
  };
  const deps: PoolDeps = { store: new MemoryPoolStore(), chain, races, now: () => t, recover: async (_m, sig) => sig };
  const pay = (n: number, from: string, tpot: string, to = ESCROW, ok = true) => transfers.set(h(n), { from, to, valueWei: parseTpot(tpot), ok });
  const race = async () => {
    await races.challengeCreate({ id: ID, seed: "0x01", tokenId: 102, date: "2026-11-05", creator: P1, createdAt: T0, expiresAt: T0 + 24 * 3_600_000 });
  };
  const seat = async (slot: "creator" | "opponent", wallet: string) => races.challengeSeat(ID, slot, { wallet, startedAt: t });
  const finish = async (slot: "creator" | "opponent", won: boolean, seconds: number) => {
    t += 1000;
    await races.challengeFinish(ID, slot, { won, seconds, moves: 10, at: t });
  };
  return { deps, pay, race, seat, finish, batches, singles, tick: (ms: number) => (t += ms), races };
}

const open = (s: ReturnType<typeof setup>) => openEvent(s.deps, { id: ID, address: P1, signature: P1 });
const back = (s: ReturnType<typeof setup>, n: number, wallet: string, side: "creator" | "opponent", tpot: string) => {
  s.pay(n, wallet, tpot);
  return backEvent(s.deps, { id: ID, wallet, side, txHash: h(n) });
};

describe("splitPot", () => {
  it("shares in proportion and never pays out more than the pot", () => {
    const out = splitPot([{ wallet: W(1), amountWei: 100n }, { wallet: W(2), amountWei: 300n }], 1000n);
    expect(out.map((p) => p.wei)).toEqual([250n, 750n]);
    const odd = splitPot([{ wallet: W(1), amountWei: 1n }, { wallet: W(2), amountWei: 1n }, { wallet: W(3), amountWei: 1n }], 10n);
    expect(odd.reduce((s, p) => s + p.wei, 0n)).toBeLessThanOrEqual(10n);
  });
  it("keeps the house cut out when one is set", () => {
    expect(splitPot([{ wallet: W(1), amountWei: 10n }], 1000n, 500)[0].wei).toBe(950n);
  });
});

describe("opening", () => {
  it("only the race creator can open, and only before the first move", async () => {
    const s = setup();
    await s.race();
    await expect(openEvent(s.deps, { id: ID, address: P2, signature: P2 })).rejects.toThrow(/Only the person who made/);
    await expect(openEvent(s.deps, { id: ID, address: P1, signature: P2 })).rejects.toThrow(/does not match/);
    const a = await open(s);
    expect(a.status).toBe("open");
    expect((await open(s)).createdAt).toBe(a.createdAt); // opening twice is harmless
  });
  it("refuses a race that does not exist or has started", async () => {
    const s = setup();
    await expect(open(s)).rejects.toThrow(/does not exist/);
    await s.race();
    await s.seat("creator", P1);
    await expect(open(s)).rejects.toThrow(/already started/);
  });
});

describe("backing", () => {
  it("counts a real transfer once and shows the pool", async () => {
    const s = setup();
    await s.race();
    await open(s);
    const r = await back(s, 1, W(1), "creator", "0.1");
    expect(r.back.refundOnly).toBeUndefined();
    expect((await back(s, 1, W(1), "creator", "0.1")).rec.backs).toHaveLength(1);
    s.pay(2, W(2), "0.1");
    await expect(backEvent(s.deps, { id: ID, wallet: W(2), side: "opponent", txHash: h(1) })).rejects.toThrow(/different wallet|already backs/);
    const v = eventView((await s.deps.store.get(ID))!, null, new Map([[W(1), "Ada"]]));
    expect(v.potTpot).toBe("0.1");
    expect(v.backs[0].name).toBe("Ada");
    expect(v.sides[1].payoutPerTpot).toBeNull();
  });
  it("rejects bad transfers", async () => {
    const s = setup();
    await s.race();
    await open(s);
    await expect(backEvent(s.deps, { id: ID, wallet: W(1), side: "creator", txHash: h(5) })).rejects.toThrow(/not found/);
    s.pay(6, W(1), "0.1", W(99));
    await expect(backEvent(s.deps, { id: ID, wallet: W(1), side: "creator", txHash: h(6) })).rejects.toThrow(/pool wallet/);
    s.pay(7, W(1), "0.1", ESCROW, false);
    await expect(backEvent(s.deps, { id: ID, wallet: W(1), side: "creator", txHash: h(7) })).rejects.toThrow(/failed on chain/);
    await expect(backEvent(s.deps, { id: ID, wallet: W(1), side: "nobody", txHash: h(7) })).rejects.toThrow(/Pick which/);
  });
  it("sends back competitors, oversized and late transfers instead of keeping them", async () => {
    const s = setup();
    await s.race();
    await open(s);
    expect((await back(s, 1, P1, "creator", "0.1")).back.refundOnly).toMatch(/Competitors/);
    expect((await back(s, 2, W(2), "creator", "0.6")).back.refundOnly).toMatch(/cap/);
    expect((await back(s, 3, W(3), "creator", "0.001")).back.refundOnly).toMatch(/minimum/);
    await s.seat("creator", P1);
    expect((await back(s, 4, W(4), "opponent", "0.1")).back.refundOnly).toMatch(/closed/);
  });
  it("caps the pool at 20 backers", async () => {
    const s = setup();
    await s.race();
    await open(s);
    for (let i = 1; i <= MAX_BACKERS; i++) await back(s, i, W(i), i % 2 ? "creator" : "opponent", "0.01");
    expect((await back(s, 50, W(50), "creator", "0.01")).back.refundOnly).toMatch(/20 backers/);
    expect(BACK_MAX_WEI).toBe(parseTpot("0.5"));
  });
});

describe("settling", () => {
  async function played(s: ReturnType<typeof setup>) {
    await s.race();
    await open(s);
    await back(s, 1, W(1), "creator", "0.1");
    await back(s, 2, W(2), "creator", "0.3");
    await back(s, 3, W(3), "opponent", "0.2");
  }
  it("locks at the first move", async () => {
    const s = setup();
    await played(s);
    expect((await resolveEvent(s.deps, ID))!.status).toBe("open");
    await s.seat("creator", P1);
    expect((await resolveEvent(s.deps, ID))!.status).toBe("locked");
    expect(s.batches).toHaveLength(0);
  });
  it("pays the winners' backers in one batch with the pool note, pro rata", async () => {
    const s = setup();
    await played(s);
    await s.seat("creator", P1);
    await s.seat("opponent", P2);
    await s.finish("creator", true, 30);
    await s.finish("opponent", true, 50);
    const rec = (await resolveEvent(s.deps, ID))!;
    expect(rec.status).toBe("settled");
    expect(rec.winner).toBe(P1);
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0].note).toBe(poolNote(ID, P1));
    const pay = Object.fromEntries(s.batches[0].payments.map((p) => [p.to, p.wei]));
    expect(pay[W(1)]).toBe(parseTpot("0.15")); // 0.6 pot x 0.1/0.4
    expect(pay[W(2)]).toBe(parseTpot("0.45"));
    expect(weiToNative(pay[W(1)])).toBe(parseTpot("0.15") / 10_000n);
    await resolveEvent(s.deps, ID);
    expect(s.batches).toHaveLength(1); // never paid twice
  });
  it("refunds everyone on a draw", async () => {
    const s = setup();
    await played(s);
    await s.seat("creator", P1);
    await s.seat("opponent", P2);
    await s.finish("creator", false, 5);
    await s.finish("opponent", false, 6);
    const rec = (await resolveEvent(s.deps, ID))!;
    expect(rec.status).toBe("refunded");
    expect(s.batches[0].note).toBe(poolNote(ID, "refund"));
    expect(s.batches[0].payments).toHaveLength(3);
  });
  it("refunds when only one side was backed, on cancel and on no show", async () => {
    const s = setup();
    await s.race();
    await open(s);
    await back(s, 1, W(1), "creator", "0.1");
    await s.seat("creator", P1);
    await s.seat("opponent", P2);
    await s.finish("creator", true, 5);
    await s.finish("opponent", false, 6);
    const rec = (await resolveEvent(s.deps, ID))!;
    expect(rec.status).toBe("refunded");
    expect(rec.reason).toMatch(/one side/);
  });
  it("refunds a cancelled race at once", async () => {
    const s = setup();
    await played(s);
    await s.races.challengeUpdate(ID, { cancelledAt: T0 + 1, expiresAt: T0 + 1 });
    s.tick(60_000);
    const rec = (await resolveEvent(s.deps, ID))!;
    expect(rec.status).toBe("refunded");
    expect(rec.reason).toMatch(/cancelled/);
  });
  it("refunds after 24 hours when the race never finishes", async () => {
    const s = setup();
    await played(s);
    await s.seat("creator", P1);
    await s.seat("opponent", P2);
    expect((await resolveEvent(s.deps, ID))!.status).toBe("locked");
    s.tick(REFUND_AFTER_MS + 1000);
    const rec = (await resolveEvent(s.deps, ID))!;
    expect(rec.status).toBe("refunded");
  });
  it("sends late and over cap transfers back in the winner batch", async () => {
    const s = setup();
    await played(s);
    await back(s, 4, W(4), "opponent", "0.9");
    await s.seat("creator", P1);
    await s.seat("opponent", P2);
    await s.finish("creator", true, 30);
    await s.finish("opponent", true, 50);
    await resolveEvent(s.deps, ID);
    const pay = s.batches[0].payments.find((p) => p.to === W(4))!;
    expect(pay.wei).toBe(parseTpot("0.9"));
  });
  it("falls back to one by one when the batch is refused, and holds back when the outcome is unknown", async () => {
    const a = setup({ batchFails: "refused" });
    await played(a);
    await a.seat("creator", P1);
    await a.seat("opponent", P2);
    await a.finish("creator", true, 30);
    await a.finish("opponent", true, 50);
    const rec = (await resolveEvent(a.deps, ID))!;
    expect(rec.status).toBe("settled");
    expect(rec.payoutMode).toBe("single");
    expect(a.singles[0]).toHaveLength(2);

    const b = setup({ batchFails: "unknown" });
    await played(b);
    await b.seat("creator", P1);
    await b.seat("opponent", P2);
    await b.finish("creator", true, 30);
    await b.finish("opponent", true, 50);
    await expect(resolveEvent(b.deps, ID)).rejects.toThrow(/timeout/);
    expect((await resolveEvent(b.deps, ID))!.status).not.toBe("settled"); // claim kept: no second attempt
    expect(b.singles).toHaveLength(0);
  });
});
