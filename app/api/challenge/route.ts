import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { cancelChallenge, challengeBoards, challengeProgress, createChallenge, getChallengeView, isChallengeId, moveChallenge, resolveChallengeStake, startChallenge, type ChallengeDeps } from "@/lib/challenge";
import { getStakeStore, stakesEnabled } from "@/lib/stakes";
import { stakeChainFromEnv } from "@/lib/stakeChain";
import { stakeView } from "@/lib/challengeStakes";
import { generateBoard, getPortalMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const deps = (): ChallengeDeps => ({
  store: getStore(),
  board: async (c) => generateBoard(await getPortalMeta(c.tokenId), c.date, c.seed),
  stakes: stakesEnabled() ? { store: getStakeStore(), chain: stakeChainFromEnv() } : null,
});

function escrowOrUndefined(d: ChallengeDeps): string | undefined {
  try {
    return d.stakes?.chain.escrowAddress();
  } catch {
    return undefined;
  }
}

// The stake on a challenge, or undefined when stakes are off or there is none. Reading it also pays out
// or refunds a settled challenge, so the result screen shows the transaction.
async function stakeFor(d: ChallengeDeps, id: string) {
  if (!d.stakes) return undefined;
  try {
    const rec = (await resolveChallengeStake(d, id)) ?? (await d.stakes.store.get(id));
    return rec ? stakeView(rec, escrowOrUndefined(d)) : undefined;
  } catch {
    const rec = await d.stakes.store.get(id);
    return rec ? stakeView(rec, escrowOrUndefined(d)) : undefined; // payout will be retried on the next read
  }
}

// GET ?id=ID: the public view of a challenge. No seed, no mines, and no times until it is settled.
// winner is the lowercase wallet of the winner once settled is true (null for a draw or an expired link).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isChallengeId(id)) return NextResponse.json({ error: "That challenge link does not exist." }, { status: 404 });
  try {
    const challenge = await getChallengeView(getStore(), id, Date.now());
    if (!challenge) return NextResponse.json({ error: "That challenge link does not exist." }, { status: 404 });
    const meta = await getPortalMeta(challenge.tokenId);
    const stake = await stakeFor(deps(), id);
    const progress = challenge.status === "playing" || challenge.settled ? await challengeProgress(deps(), id).catch(() => undefined) : undefined;
    const wantBoards = new URL(req.url).searchParams.get("boards") === "1";
    // Open tiles show which tiles are safe, so they are shared only in a live duel (watching is the point) or after the result is in.
    const boards = wantBoards && (challenge.settled || (challenge.duel && challenge.status === "playing")) ? await challengeBoards(deps(), id).catch(() => undefined) : undefined;
    return NextResponse.json({ challenge, meta: { id: meta.id, name: meta.name, image: meta.image }, ...(progress ? { progress } : {}), ...(boards ? { boards } : {}), ...(stake ? { stake } : {}) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not load that challenge." }, { status: 500 });
  }
}

// { action: "create", address, signature } makes a challenge and returns its id.
// { action: "start", id, address, signature } takes a seat (or picks a running try back up); the board
// comes back with its mines hidden. { action: "move", id, address, signature, move } plays one move.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    if (b.action === "create") {
      const out = await createChallenge(deps(), { address: b.address, signature: b.signature, tokenId: b.tokenId, stakeTpot: b.stakeTpot, duel: b.duel });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      const stake = await stakeFor(deps(), out.challenge.id);
      return NextResponse.json({ challenge: out.challenge, ...(stake ? { stake } : {}) }, { headers: NO_STORE });
    }
    if (b.action === "cancel") {
      const out = await cancelChallenge(deps(), { id: b.id, address: b.address, signature: b.signature });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      const stake = await stakeFor(deps(), out.challenge.id);
      return NextResponse.json({ challenge: out.challenge, ...(stake ? { stake } : {}) }, { headers: NO_STORE });
    }
    if (b.action === "start") {
      const out = await startChallenge(deps(), { id: b.id, address: b.address, signature: b.signature });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      const meta = await getPortalMeta(out.challenge.tokenId);
      return NextResponse.json({ board: out.live.board, live: out.live, meta, slot: out.slot, challenge: out.challenge }, { headers: NO_STORE });
    }
    if (b.action === "move") {
      const out = await moveChallenge(deps(), { id: b.id, address: b.address, signature: b.signature, move: b.move });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      const stake = out.challenge ? await stakeFor(deps(), out.challenge.id) : undefined;
      return NextResponse.json({ live: out.live, challenge: out.challenge, ...(stake ? { stake } : {}) }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
