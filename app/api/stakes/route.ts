import { NextResponse } from "next/server";
import { createStake, formatTpot, getStake, getStakeStore, lockStake, potWei, stakesEnabled, type StakeRecord } from "@/lib/stakes";
import { portaldotStakeChain } from "@/lib/stakeChain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const off = () => NextResponse.json({ error: "Stakes are not switched on." }, { status: 404 });

// What the page needs to show a pot. Nothing private is in a stake record.
function view(r: StakeRecord, escrow?: string) {
  return {
    challengeId: r.challengeId,
    status: r.status,
    stakeTpot: formatTpot(r.amountWei),
    potTpot: formatTpot(potWei(r)),
    creator: r.creator,
    opponent: r.opponent ?? null,
    locks: r.locks,
    winner: r.winner ?? null,
    payoutTx: r.payoutTx ?? null,
    refundTxs: r.refundTxs ?? [],
    escrow: escrow ?? null,
    note: "Testnet tPOT, no value.",
  };
}

function escrowOrNull(): string | undefined {
  try {
    return portaldotStakeChain().escrowAddress();
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  if (!stakesEnabled()) return off();
  const id = new URL(req.url).searchParams.get("challenge");
  if (!id) return NextResponse.json({ error: "Missing challenge." }, { status: 400 });
  const rec = await getStake({ store: getStakeStore(), chain: portaldotStakeChain() }, id);
  return rec ? NextResponse.json(view(rec, escrowOrNull()), { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "No stake on this challenge." }, { status: 404 });
}

// { action: "create", challengeId, wallet, amountTpot } or { action: "lock", challengeId, wallet, txHash }.
// A lock is checked against the chain, so it does not need a signature: only a real transfer from that wallet counts.
export async function POST(req: Request) {
  if (!stakesEnabled()) return off();
  let b: { action?: string; challengeId?: string; wallet?: string; amountTpot?: string; txHash?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const deps = { store: getStakeStore(), chain: portaldotStakeChain() };
  try {
    if (b.action === "create") {
      const rec = await createStake(deps, String(b.challengeId ?? ""), { creator: String(b.wallet ?? ""), amountTpot: String(b.amountTpot ?? "") });
      return NextResponse.json(view(rec, escrowOrNull()));
    }
    if (b.action === "lock") {
      const rec = await lockStake(deps, String(b.challengeId ?? ""), String(b.wallet ?? ""), String(b.txHash ?? ""));
      return NextResponse.json(view(rec, escrowOrNull()));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not do that." }, { status: 400 });
  }
}
