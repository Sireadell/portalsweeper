import { describe, it, expect } from "vitest";
import { MemoryStakeStore, createStake, lockStake, settleStake, refundStake, type StakeChain } from "./stakes";

const A = "0x3E5E603dcEc9F5aa559cb7Be470ea0997EdCf62e";
const B = "0x9833afD5f9D1007d88CfA3BE9e6c700e0949f9F3";
const ESCROW = "0x9cebe7c313b0c86c55d956a3d07bd191fddabf9a";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function contractChain() {
  const calls: string[] = [];
  const chain: StakeChain = {
    escrowAddress: () => ESCROW,
    async getTransfer(tx) {
      const from = tx === hash(1) ? A : B;
      return { from, to: ESCROW, valueWei: 10n ** 16n, ok: true };
    },
    async send() {
      throw new Error("must not send from a wallet");
    },
    async settle(id, winner) {
      calls.push(`settle ${id} ${winner}`);
      return { txHash: hash(9), block: 5 };
    },
    async refundAll(id) {
      calls.push(`refundAll ${id}`);
      return { txHash: hash(8), block: 6 };
    },
  };
  return { chain, calls };
}

async function lockedStake(id: string) {
  const { chain, calls } = contractChain();
  const deps = { store: new MemoryStakeStore(), chain };
  await createStake(deps, id, { creator: A, amountTpot: "0.01" });
  await lockStake(deps, id, A, hash(1));
  await lockStake(deps, id, B, hash(2));
  return { deps, calls };
}

describe("stakes through the escrow contract", () => {
  it("pays the winner with one contract call", async () => {
    const { deps, calls } = await lockedStake("c1");
    const rec = await settleStake(deps, "c1", B);
    expect(calls).toEqual([`settle c1 ${B.toLowerCase()}`]);
    expect(rec.payoutTx).toBe(hash(9));
    expect(rec.status).toBe("settled");
  });

  it("refunds a draw with one contract call", async () => {
    const { deps, calls } = await lockedStake("c2");
    const rec = await refundStake(deps, "c2");
    expect(calls).toEqual(["refundAll c2"]);
    expect(rec.refundTxs).toEqual([hash(8)]);
    expect(rec.status).toBe("refunded");
  });
});
