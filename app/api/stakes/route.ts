import { NextResponse } from "next/server";
import { createStake, getStake, getStakeStore, lockPortal, lockStake, stakesEnabled } from "@/lib/stakes";
import { escrowFor, stakeView } from "@/lib/challengeStakes";
import { getApi, mappedAccount } from "@/lib/native";
import { PALLETS_ADDRESS, ethCallData } from "@/lib/swap";
import { lockCall } from "@/lib/portalStake";
import { getStore } from "@/lib/records";
import { getChallengeWinner } from "@/lib/challenge";
import { stakeChainFromEnv } from "@/lib/stakeChain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const off = () => NextResponse.json({ error: "Stakes are not switched on." }, { status: 404 });

function escrowOrNull(rec: Parameters<typeof escrowFor>[1]): string | undefined {
  return escrowFor(stakeChainFromEnv(), rec);
}

export async function GET(req: Request) {
  if (!stakesEnabled()) return off();
  const id = new URL(req.url).searchParams.get("challenge");
  if (!id) return NextResponse.json({ error: "Missing challenge." }, { status: 400 });
  const rec = await getStake({ store: getStakeStore(), chain: stakeChainFromEnv() }, id);
  return rec ? NextResponse.json(stakeView(rec, escrowOrNull(rec)), { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "No stake on this challenge." }, { status: 404 });
}

// { action: "create", challengeId, wallet, amountTpot } or { action: "lock", challengeId, wallet, txHash }.
// A lock is checked against the chain, so it does not need a signature: only a real transfer from that wallet counts.
export async function POST(req: Request) {
  if (!stakesEnabled()) return off();
  let b: { action?: string; challengeId?: string; wallet?: string; amountTpot?: string; txHash?: string; portal?: number };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const deps = { store: getStakeStore(), chain: stakeChainFromEnv() };
  try {
    if (b.action === "create") {
      // A challenge sets its own stake when it is made; adding one to an existing challenge is refused.
      if (await getStore().challengeGet(String(b.challengeId ?? ""))) throw new Error("A stake is set when the challenge is made.");
      const rec = await createStake(deps, String(b.challengeId ?? ""), { creator: String(b.wallet ?? ""), amountTpot: String(b.amountTpot ?? "") });
      return NextResponse.json(stakeView(rec, escrowOrNull(rec)));
    }
    // The bytes for the wallet transaction that moves a Portal to the escrow wallet (the browser cannot build them).
    if (b.action === "portalcall") {
      const rec = await getStake(deps, String(b.challengeId ?? ""));
      if (!rec || rec.asset !== "portal") throw new Error("This challenge does not stake a Portal.");
      const escrow = escrowFor(deps.chain, rec);
      if (!escrow) throw new Error("Portal stakes are not available.");
      if (typeof b.portal !== "number") throw new Error("Pick a Portal.");
      return NextResponse.json({ to: PALLETS_ADDRESS, data: ethCallData(lockCall(await getApi(), b.portal, mappedAccount(escrow))) });
    }
    if (b.action === "lock") {
      const over = await getChallengeWinner(getStore(), String(b.challengeId ?? ""));
      if (over.found && over.settled) throw new Error("This challenge is over, so do not send a stake to it.");
      const rec = typeof b.portal === "number"
        ? await lockPortal(deps, String(b.challengeId ?? ""), String(b.wallet ?? ""), b.portal, String(b.txHash ?? ""))
        : await lockStake(deps, String(b.challengeId ?? ""), String(b.wallet ?? ""), String(b.txHash ?? ""));
      return NextResponse.json(stakeView(rec, escrowOrNull(rec)));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not do that." }, { status: 400 });
  }
}
