import type { Hex, PublicClient } from "viem";
import record from "../proof/stake-run.json";
import { publicClient } from "./ledger";

export type StakeStep = { kind: "topup" | "lockA" | "lockB" | "payout" | "refund"; match: "setup" | "win" | "draw"; hash: Hex; block: number };

type Tx = { hash: string; block: number };
type Run = { topUps: Tx[]; win: { lockA: Tx; lockB: Tx; record: { payoutTx: string; payoutBlock: number } }; draw: { lockA: Tx; lockB: Tx; record: { refundTxs: string[]; refundBlocks: number[] } } };

// The steps of the recorded stake run, in the order they happened.
export function stakeSteps(run: Run = record as unknown as Run): StakeStep[] {
  const s: StakeStep[] = [];
  for (const t of run.topUps) s.push({ kind: "topup", match: "setup", hash: t.hash as Hex, block: t.block });
  s.push({ kind: "lockA", match: "win", hash: run.win.lockA.hash as Hex, block: run.win.lockA.block });
  s.push({ kind: "lockB", match: "win", hash: run.win.lockB.hash as Hex, block: run.win.lockB.block });
  s.push({ kind: "payout", match: "win", hash: run.win.record.payoutTx as Hex, block: run.win.record.payoutBlock });
  s.push({ kind: "lockA", match: "draw", hash: run.draw.lockA.hash as Hex, block: run.draw.lockA.block });
  s.push({ kind: "lockB", match: "draw", hash: run.draw.lockB.hash as Hex, block: run.draw.lockB.block });
  run.draw.record.refundTxs.forEach((h, i) => s.push({ kind: "refund", match: "draw", hash: h as Hex, block: run.draw.record.refundBlocks[i] }));
  return s;
}

// Reads each receipt from the chain now. A step the chain cannot confirm right now is false.
export async function confirmSteps(steps: StakeStep[], pub: PublicClient = publicClient()): Promise<boolean[]> {
  return Promise.all(
    steps.map(async (s) => {
      try {
        return (await pub.getTransactionReceipt({ hash: s.hash })).status === "success";
      } catch {
        return false;
      }
    }),
  );
}
