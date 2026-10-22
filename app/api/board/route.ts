import { NextResponse } from "next/server";
import { PORTAL_SUPPLY } from "@/lib/types";
import { getDailySalt, isRevealable, isValidDate, utcToday } from "@/lib/salt";
import { getStore } from "@/lib/records";
import { dailyMove, dailyState, parseMove } from "@/lib/live";
import { generateBoard, getPortalMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

function badToken(tokenId: number) {
  return !Number.isInteger(tokenId) || tokenId < 1 || tokenId > PORTAL_SUPPLY;
}

async function realBoard(tokenId: number, date: string) {
  return generateBoard(await getPortalMeta(tokenId), date, getDailySalt(date));
}

// GET ?token=N: today's board for one Portal, with the mines hidden, plus the game so far.
// GET ?token=N&date=PAST: a finished day's full board (its salt is public by then anyway).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const tokenId = Number(q.get("token"));
  const date = q.get("date") ?? utcToday();
  if (badToken(tokenId)) return NextResponse.json({ error: `Pick a Portal number from 1 to ${PORTAL_SUPPLY}.` }, { status: 400 });
  if (!isValidDate(date)) return NextResponse.json({ error: "Use a date like 2026-10-20." }, { status: 400 });
  if (date > utcToday()) return NextResponse.json({ error: "That day has not started yet." }, { status: 400 });
  try {
    const board = await realBoard(tokenId, date);
    if (isRevealable(date)) return NextResponse.json({ board, live: null }, { headers: NO_STORE });
    const live = await dailyState(getStore(), board, Date.now());
    return NextResponse.json({ board: live.board, live }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not build that board." }, { status: 500 });
  }
}

// POST { token, move: { action, idx } }: one move on today's board. The result is recorded when the game ends.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const tokenId = Number(b.token);
  const move = parseMove(b.move);
  if (badToken(tokenId)) return NextResponse.json({ error: "Unknown Portal." }, { status: 400 });
  if (!move) return NextResponse.json({ error: "That move is not valid." }, { status: 400 });
  try {
    const live = await dailyMove(getStore(), await realBoard(tokenId, utcToday()), move, Date.now());
    return NextResponse.json({ live }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
