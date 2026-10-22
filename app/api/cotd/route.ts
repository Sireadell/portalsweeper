import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { getDailySalt } from "@/lib/salt";
import { moveRanked, startRanked, summarize, type BoardFor, type CotdDeps } from "@/lib/cotd";
import { generateBoard, getPortalMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const boardFor: BoardFor = async (tokenId, date) => generateBoard(await getPortalMeta(tokenId), date, getDailySalt(date));
const deps = (): CotdDeps & { board: BoardFor } => ({ store: getStore(), board: boardFor });

// Today's featured Portal, the leaderboard, yesterday's winner. ?address=0x.. adds that wallet's own status.
export async function GET(req: Request) {
  try {
    const address = new URL(req.url).searchParams.get("address");
    const s = await summarize(getStore(), new Date(), address);
    const meta = await getPortalMeta(s.tokenId);
    return NextResponse.json({ ...s, meta: { id: meta.id, name: meta.name, image: meta.image } }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not load the Portal of the day." }, { status: 500 });
  }
}

// { action: "start", address, signature } claims (or resumes) the one ranked try. The board comes back
// with its mines hidden. { action: "move", address, signature, date, move } plays one move on the server.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    if (b.action === "start") {
      const out = await startRanked(deps(), { address: b.address, signature: b.signature });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      const meta = await getPortalMeta(out.entry.tokenId);
      return NextResponse.json({ board: out.live.board, live: out.live, meta, startedAt: out.entry.startedAt }, { headers: NO_STORE });
    }
    if (b.action === "move") {
      const out = await moveRanked(deps(), b as Parameters<typeof moveRanked>[1]);
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      return NextResponse.json({ live: out.live, rank: out.rank }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
