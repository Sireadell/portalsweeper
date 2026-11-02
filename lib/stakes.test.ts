import { describe, expect, it } from "vitest";
import {
  MemoryStakeStore,
  createStake,
  formatTpot,
  lockStake,
  parseTpot,
  refundStake,
  settleStake,
  type ChainTransfer,
  type StakeChain,
  type StakeDeps,
} from "./stakes";

const ESCROW = "0x00000000000000000000000000000000000e5c20";
const A = "0x" + "a1".repeat(20);
const B = "0x" + "b2".repeat(20);
const C = "0x" + "c3".repeat(20);
const h = (n: number) => "0x" + n.toString(16).padStart(64, "0");

function setup() {
  const transfers = new Map<string, ChainTransfer>();
  const sent: { to: string; wei: bigint }[] = [];
  const chain: StakeChain = {
    escrowAddress: () => ESCROW,
    getTransfer: async (tx) => transfers.get(tx.toLowerCase()) ?? null,
    send: async (to, wei) => {
      sent.push({ to, wei });
      return { txHash: h(900 + sent.length) };
    },
  };
  const deps: StakeDeps = { store: new MemoryStakeStore(), chain, now: () => 1000 };
  const pay = (n: number, from: string, tpot: string, to = ESCROW, ok = true) =>
    transfers.set(h(n), { from, to, valueWei: parseTpot(tpot), ok });
  return { deps, sent, pay };
}

describe("amounts", () => {
  it("parses and formats tPOT", () => {
    expect(parseTpot("0.05")).toBe(50_000_000_000_000_000n);
    expect(formatTpot(parseTpot("1"))).toBe("1");
    expect(formatTpot(parseTpot("0.012"))).toBe("0.012");
  });
  it("rejects bad, zero and oversized amounts", () => {
    expect(() => parseTpot("abc")).toThrow();
    expect(() => parseTpot("0")).toThrow();
    expect(() => parseTpot("-1")).toThrow();
    expect(() => parseTpot("1.5")).toThrow(/capped/);
  });
});

describe("a stake from start to payout", () => {
  it("locks both players and pays the whole pot to the winner", async () => {
    const { deps, sent, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    pay(1, A, "0.1");
    pay(2, B, "0.1");
    expect((await lockStake(deps, "c1", A, h(1))).status).toBe("open");
    const locked = await lockStake(deps, "c1", B, h(2));
    expect(locked.status).toBe("locked");
    expect(locked.opponent).toBe(B);
    const done = await settleStake(deps, "c1", B);
    expect(done.status).toBe("settled");
    expect(done.winner).toBe(B);
    expect(sent).toEqual([{ to: B, wei: parseTpot("0.2") }]);
  });

  it("never pays twice", async () => {
    const { deps, sent, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    pay(1, A, "0.1");
    pay(2, B, "0.1");
    await lockStake(deps, "c1", A, h(1));
    await lockStake(deps, "c1", B, h(2));
    await settleStake(deps, "c1", A);
    await settleStake(deps, "c1", A);
    expect(sent).toHaveLength(1);
  });

  it("refuses to pay before both stakes are in, or to a stranger", async () => {
    const { deps, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    pay(1, A, "0.1");
    pay(2, B, "0.1");
    await lockStake(deps, "c1", A, h(1));
    await expect(settleStake(deps, "c1", A)).rejects.toThrow(/lock their stake/);
    await lockStake(deps, "c1", B, h(2));
    await expect(settleStake(deps, "c1", C)).rejects.toThrow(/not a player/);
  });

  it("refunds each locked stake", async () => {
    const { deps, sent, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    pay(1, A, "0.1");
    await lockStake(deps, "c1", A, h(1));
    const r = await refundStake(deps, "c1");
    expect(r.status).toBe("refunded");
    expect(sent).toEqual([{ to: A, wei: parseTpot("0.1") }]);
    await refundStake(deps, "c1");
    expect(sent).toHaveLength(1);
    await expect(settleStake(deps, "c1", A)).rejects.toThrow();
  });
});

describe("a lock only counts if chain agrees", () => {
  it("rejects wrong sender, wrong receiver, too little, failed and unknown transfers", async () => {
    const { deps, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    pay(1, C, "0.1");
    pay(2, A, "0.1", C);
    pay(3, A, "0.05");
    pay(4, A, "0.1", ESCROW, false);
    await expect(lockStake(deps, "c1", A, h(1))).rejects.toThrow(/different wallet/);
    await expect(lockStake(deps, "c1", A, h(2))).rejects.toThrow(/escrow/);
    await expect(lockStake(deps, "c1", A, h(3))).rejects.toThrow(/less than/);
    await expect(lockStake(deps, "c1", A, h(4))).rejects.toThrow(/failed/);
    await expect(lockStake(deps, "c1", A, h(5))).rejects.toThrow(/not found/);
    await expect(lockStake(deps, "c1", "nope", h(1))).rejects.toThrow();
  });

  it("does not let one transfer back two stakes", async () => {
    const { deps, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    await createStake(deps, "c2", { creator: A, amountTpot: "0.1" });
    pay(1, A, "0.1");
    await lockStake(deps, "c1", A, h(1));
    await expect(lockStake(deps, "c2", A, h(1))).rejects.toThrow(/already backs/);
  });

  it("accepts only two players", async () => {
    const { deps, pay } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    pay(1, A, "0.1");
    pay(2, B, "0.1");
    pay(3, C, "0.1");
    await lockStake(deps, "c1", A, h(1));
    await lockStake(deps, "c1", B, h(2));
    await expect(lockStake(deps, "c1", C, h(3))).rejects.toThrow(/no longer open/);
  });

  it("does not create the same stake twice", async () => {
    const { deps } = setup();
    await createStake(deps, "c1", { creator: A, amountTpot: "0.1" });
    await expect(createStake(deps, "c1", { creator: A, amountTpot: "0.1" })).rejects.toThrow(/already/);
  });
});
