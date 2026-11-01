import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { createChallenge, getChallengeView, isChallengeId, moveChallenge, startChallenge, type ChallengeDeps } from "@/lib/challenge";
import { generateBoard, getPortalMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const deps = (): ChallengeDeps => ({
  store: getStore(),
  board: async (c) => generateBoard(await getPortalMeta(c.tokenId), c.date, c.seed),
});

// GET ?id=ID: the public view of a challenge. No seed, no mines, and no times until it is settled.
// winner is the lowercase wallet of the winner once settled is true (null for a draw or an expired link).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isChallengeId(id)) return NextResponse.json({ error: "That challenge link does not exist." }, { status: 404 });
  try {
    const challenge = await getChallengeView(getStore(), id, Date.now());
    if (!challenge) return NextResponse.json({ error: "That challenge link does not exist." }, { status: 404 });
    const meta = await getPortalMeta(challenge.tokenId);
    return NextResponse.json({ challenge, meta: { id: meta.id, name: meta.name, image: meta.image } }, { headers: NO_STORE });
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
      const out = await createChallenge(deps(), { address: b.address, signature: b.signature, tokenId: b.tokenId });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      return NextResponse.json({ challenge: out.challenge }, { headers: NO_STORE });
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
      return NextResponse.json({ live: out.live, challenge: out.challenge }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
