import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import {
  BACK_MAX_WEI, MAX_BACKERS, MemoryPoolStore, REFUND_AFTER_MS, backEvent, cutOf, eventView, openEvent, poolCutBps, resolveEvent, splitPot,
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
    expect(splitPot([{ wallet: W(1), amountWei: 10n }], 1_000_000n, 500)[0].wei).toBe(950_000n);
  });
});

describe("the pool cut", () => {
  const TREASURY = "0x" + "7e".repeat(20);
  const withCut = async <T,>(bps: string | undefined, f: () => Promise<T>): Promise<T> => {
    const old = { b: process.env.POOL_CUT_BPS, t: process.env.TREASURY_ADDRESS };
    if (bps === undefined) delete process.env.POOL_CUT_BPS; else process.env.POOL_CUT_BPS = bps;
    process.env.TREASURY_ADDRESS = TREASURY;
    try {
      return await f();
    } finally {
      if (old.b === undefined) delete process.env.POOL_CUT_BPS; else process.env.POOL_CUT_BPS = old.b;
      if (old.t === undefined) delete process.env.TREASURY_ADDRESS; else process.env.TREASURY_ADDRESS = old.t;
    }
  };
  const total = (ps: Payment[]) => ps.reduce((s, p) => s + p.wei, 0n);

  it("reads the setting safely: off unless it is a whole number from 0 to 1000", () => {
    expect(poolCutBps(undefined)).toBe(0);
    expect(poolCutBps("")).toBe(0);
    expect(poolCutBps("500")).toBe(500);
    expect(poolCutBps(" 250 ")).toBe(250);
    expect(poolCutBps("5%")).toBe(0);
    expect(poolCutBps("-5")).toBe(0);
    expect(poolCutBps("9999")).toBe(0);
    expect(poolCutBps("1001")).toBe(0);
  });
  it("takes exactly 5% of a round pot, 0% leaves it whole", () => {
    const pot = parseTpot("0.6");
    expect(cutOf(pot, 500)).toBe(parseTpot("0.03"));
    expect(cutOf(pot, 0)).toBe(0n);
    const w = [{ wallet: W(1), amountWei: parseTpot("0.1") }, { wallet: W(2), amountWei: parseTpot("0.3") }];
    expect(total(splitPot(w, pot, 0))).toBe(pot);
    const five = splitPot(w, pot, 500);
    expect(total(five)).toBe(parseTpot("0.57"));
    expect(total(five) + cutOf(pot, 500)).toBe(pot);
  });
  it("odd amounts: winners plus cut never come to more than the pot, and the cut is a whole chain unit", () => {
    for (const pot of [1n, 9_999n, 10_000n, 123_456_789_012_345_678n, 999_999_999_999_999_999n, 7n * 10n ** 17n + 3n]) {
      for (const bps of [0, 1, 500, 999, 1000]) {
        const w = [{ wallet: W(1), amountWei: 3n }, { wallet: W(2), amountWei: 5n }, { wallet: W(3), amountWei: 7n }];
        const cut = cutOf(pot, bps);
        expect(cut % 10_000n).toBe(0n);
        expect(cut * 10_000n).toBeLessThanOrEqual(pot * BigInt(bps));
        expect(total(splitPot(w, pot, bps)) + cut).toBeLessThanOrEqual(pot);
      }
    }
  });
  it("a cut too small to send is not taken", () => {
    expect(cutOf(1_000n, 500)).toBe(0n);
    expect(cutOf(0n, 500)).toBe(0n);
  });
  it("one backer on the winning side still gets the pot minus the cut", () => {
    const out = splitPot([{ wallet: W(1), amountWei: parseTpot("0.2") }], parseTpot("1"), 500);
    expect(out).toEqual([{ to: W(1), wei: parseTpot("0.95") }]);
  });
  it("is off by default: the payout and the note are exactly as before", async () => {
    await withCut(undefined, async () => {
      const s = setup();
      await s.race();
      await open(s);
      await back(s, 1, W(1), "creator", "0.1");
      await back(s, 3, W(3), "opponent", "0.2");
      await s.seat("creator", P1);
      await s.seat("opponent", P2);
      await s.finish("creator", true, 30);
      await s.finish("opponent", true, 50);
      const rec = (await resolveEvent(s.deps, ID))!;
      expect(rec.cutWei).toBeUndefined();
      expect(s.batches[0].note).toBe(poolNote(ID, P1));
      expect(s.batches[0].payments).toEqual([{ to: W(1), wei: parseTpot("0.3") }]);
    });
  });
  it("5% goes to the treasury in the same batch, with a note that states pot, cut and each backer", async () => {
    await withCut("500", async () => {
      const s = setup();
      await s.race();
      await open(s);
      await back(s, 1, W(1), "creator", "0.1");
      await back(s, 2, W(2), "creator", "0.3");
      await back(s, 3, W(3), "opponent", "0.2");
      await s.seat("creator", P1);
      await s.seat("opponent", P2);
      await s.finish("creator", true, 30);
      await s.finish("opponent", true, 50);
      const rec = (await resolveEvent(s.deps, ID))!;
      expect(rec.status).toBe("settled");
      expect(s.batches).toHaveLength(1);
      const pay = s.batches[0].payments;
      const to = Object.fromEntries(pay.map((p) => [p.to, p.wei]));
      expect(to[TREASURY]).toBe(parseTpot("0.03"));
      expect(to[W(1)]).toBe(parseTpot("0.1425")); // 0.57 x 0.1/0.4
      expect(to[W(2)]).toBe(parseTpot("0.4275"));
      expect(total(pay)).toBeLessThanOrEqual(parseTpot("0.6"));
      const note = s.batches[0].note;
      expect(note).toContain(poolNote(ID, P1));
      expect(note).toContain("pot=0.6");
      expect(note).toContain(`cut=0.03(5%)->${TREASURY}`);
      expect(note).toContain(`${W(1)}=0.1425`);
      expect(note).toContain(`${W(2)}=0.4275`);
      expect(rec.cutWei).toBe(parseTpot("0.03").toString());
      const v = eventView(rec, null, new Map(), ESCROW);
      expect(v.note).toBe(note);
      expect(v.cut.paidTpot).toBe("0.03");
      expect(v.cut.percent).toBe(5);
    });
  });
  it("the percent a backer was told is the percent applied, even if the setting changes later", async () => {
    const s = setup();
    await withCut("500", async () => { await s.race(); await open(s); });
    await back(s, 1, W(1), "creator", "0.1");
    await back(s, 3, W(3), "opponent", "0.2");
    await s.seat("creator", P1);
    await s.seat("opponent", P2);
    await s.finish("creator", true, 30);
    await s.finish("opponent", true, 50);
    await withCut("0", async () => { await resolveEvent(s.deps, ID); });
    expect(s.batches[0].payments.find((p) => p.to === TREASURY)?.wei).toBe(parseTpot("0.015"));
  });
  it("without a treasury setting the cut stays in the escrow wallet and no extra transfer is made", async () => {
    const old = process.env.TREASURY_ADDRESS;
    delete process.env.TREASURY_ADDRESS;
    try {
      await withCut("500", async () => { delete process.env.TREASURY_ADDRESS; });
      process.env.POOL_CUT_BPS = "500";
      const s = setup();
      await s.race();
      await open(s);
      await back(s, 1, W(1), "creator", "0.1");
      await back(s, 3, W(3), "opponent", "0.2");
      await s.seat("creator", P1);
      await s.seat("opponent", P2);
      await s.finish("creator", true, 30);
      await s.finish("opponent", true, 50);
      const rec = (await resolveEvent(s.deps, ID))!;
      expect(s.batches[0].payments).toEqual([{ to: W(1), wei: parseTpot("0.285") }]);
      expect(rec.cutTo).toBe(ESCROW);
      expect(s.batches[0].note).toContain(`->${ESCROW}`);
    } finally {
      delete process.env.POOL_CUT_BPS;
      if (old !== undefined) process.env.TREASURY_ADDRESS = old;
    }
  });
  it("refunds take no cut (draw, cancel and 24 hours)", async () => {
    await withCut("500", async () => {
      const draw = setup();
      await draw.race();
      await open(draw);
      await back(draw, 1, W(1), "creator", "0.1");
      await back(draw, 3, W(3), "opponent", "0.2");
      await draw.seat("creator", P1);
      await draw.seat("opponent", P2);
      await draw.finish("creator", false, 5);
      await draw.finish("opponent", false, 6);
      const r = (await resolveEvent(draw.deps, ID))!;
      expect(r.status).toBe("refunded");
      expect(draw.batches[0].payments).toEqual([{ to: W(1), wei: parseTpot("0.1") }, { to: W(3), wei: parseTpot("0.2") }]);
      expect(draw.batches[0].note).toBe(poolNote(ID, "refund"));
      expect(r.cutWei).toBeUndefined();

      const late = setup();
      await late.race();
      await open(late);
      await back(late, 1, W(1), "creator", "0.1");
      await back(late, 3, W(3), "opponent", "0.2");
      late.tick(REFUND_AFTER_MS + 1000);
      const l = (await resolveEvent(late.deps, ID))!;
      expect(l.status).toBe("refunded");
      expect(total(late.batches[0].payments)).toBe(parseTpot("0.3"));
      expect(late.batches[0].payments.some((p) => p.to === TREASURY)).toBe(false);
    });
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
