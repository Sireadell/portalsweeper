import { NextResponse } from "next/server";
import { getStakeStore, refundStake, settleStake, stakesEnabled } from "@/lib/stakes";
import { portaldotStakeChain } from "@/lib/stakeChain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Server to server only (same secret as the timers). The challenge flow normally calls settleStake
// or refundStake from lib/stakes directly when a match ends; this route lets an operator do it by hand.
// { challengeId, winner } pays the pot to the winner, { challengeId, refund: true } returns the stakes.
export async function POST(req: Request) {
  if (!stakesEnabled()) return NextResponse.json({ error: "Stakes are not switched on." }, { status: 404 });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    const b = (await req.json()) as { challengeId?: string; winner?: string; refund?: boolean };
    const deps = { store: getStakeStore(), chain: portaldotStakeChain() };
    const id = String(b.challengeId ?? "");
    const rec = b.refund ? await refundStake(deps, id) : await settleStake(deps, id, String(b.winner ?? ""));
    return NextResponse.json({ status: rec.status, winner: rec.winner ?? null, payoutTx: rec.payoutTx ?? null, refundTxs: rec.refundTxs ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not settle." }, { status: 400 });
  }
}
