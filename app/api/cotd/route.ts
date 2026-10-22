import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { getDailySalt } from "@/lib/salt";
import { finishRanked, startRanked, summarize, type CotdDeps } from "@/lib/cotd";
import { generateBoard, getPortalMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const deps = (): CotdDeps => ({ store: getStore() });

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

// { action: "start", address, signature } claims the one ranked try and returns the board.
// { action: "finish", address, signature, date, won, seconds, moves } records the result.
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
      const board = generateBoard(meta, out.entry.date, getDailySalt(out.entry.date));
      return NextResponse.json({ board, meta, startedAt: out.entry.startedAt }, { headers: NO_STORE });
    }
    if (b.action === "finish") {
      const out = await finishRanked(deps(), b as Parameters<typeof finishRanked>[1]);
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      return NextResponse.json({ entry: out.entry, rank: out.rank }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
