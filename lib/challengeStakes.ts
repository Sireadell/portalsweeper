// The link between friend challenges and stakes. Kept free of challenge.ts values so the two can import
// each other's types without a loop. The rule: once a challenge is settled, a locked stake pays the winner
// and anything else (a draw, an expired link, only one side locked) goes back to whoever locked.
import { formatTpot, potWei, refundStake, settleStake, type StakeDeps, type StakeRecord } from "./stakes";
import type { ChallengeWinner } from "./challenge";

// What the page needs to show a pot. Nothing private is in a stake record.
export function stakeView(r: StakeRecord, escrow?: string) {
  const portal = r.asset === "portal";
  return {
    asset: (portal ? "portal" : "tpot") as "portal" | "tpot",
    challengeId: r.challengeId,
    status: r.status,
    stakeTpot: portal ? "0" : formatTpot(r.amountWei),
    potTpot: formatTpot(potWei(r)),
    creator: r.creator,
    opponent: r.opponent ?? null,
    locks: r.locks,
    winner: r.winner ?? null,
    payoutTx: r.payoutTx ?? null,
    payoutBlock: r.payoutBlock ?? null,
    refundTxs: r.refundTxs ?? [],
    refundBlocks: r.refundBlocks ?? [],
    escrow: escrow ?? null,
    note: portal ? "Testnet Portals. Trusted custody: the game server holds staked Portals until the race ends." : "Testnet tPOT, no value.",
  };
}

// Pays or refunds once the challenge is settled. Safe to call from many places at once: a claim on the
// challenge id lets one caller through, and a finished stake is just returned. If the chain send fails
// the claim is released so the next call (or the timer) tries again.
// The wallet a player sends their stake to: the escrow wallet for Portals, else the escrow address (wallet or contract).
export function escrowFor(chain: StakeDeps["chain"], r: StakeRecord): string | undefined {
  try {
    return r.asset === "portal" ? chain.portalEscrowAddress?.() : chain.escrowAddress();
  } catch {
    return undefined;
  }
}

export async function resolveStake(deps: StakeDeps, challengeId: string, result: ChallengeWinner): Promise<StakeRecord | null> {
  const rec = await deps.store.get(challengeId);
  if (!rec) return null;
  if (rec.status === "settled" || rec.status === "refunded") return rec;
  if (!result.found || !result.settled) return rec;
  const claim = `resolve:${challengeId}`;
  if (!(await deps.store.claimTx(claim, challengeId))) return rec; // another call is paying right now
  try {
    if (rec.status === "locked" && result.winner) return await settleStake(deps, challengeId, result.winner);
    return await refundStake(deps, challengeId);
  } catch (e) {
    await deps.store.releaseTx(claim);
    throw e;
  }
}
