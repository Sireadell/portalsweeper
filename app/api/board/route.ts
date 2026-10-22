import { NextResponse } from "next/server";
import { POT_SUPPLY } from "@/lib/types";
import { getDailySalt, isValidDate, utcToday } from "@/lib/salt";
import { generateBoard, getPotMeta } from "../_deps";

export const dynamic = "force-dynamic";

// The board for one Pot on one day, mines included, so the browser can play it.
// Trust limit: this server holds the salt and sends today's board to the player.
// The on-chain fingerprint stops the operator changing a board AFTER the fact,
// it does not hide the board from the server while the day is live.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const tokenId = Number(q.get("token"));
  const date = q.get("date") ?? utcToday();
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > POT_SUPPLY)
    return NextResponse.json({ error: `Pick a Pot number from 1 to ${POT_SUPPLY}.` }, { status: 400 });
  if (!isValidDate(date)) return NextResponse.json({ error: "Use a date like 2026-10-20." }, { status: 400 });
  if (date > utcToday()) return NextResponse.json({ error: "That day has not started yet." }, { status: 400 });
  try {
    const meta = await getPotMeta(tokenId);
    const board = generateBoard(meta, date, getDailySalt(date));
    return NextResponse.json(board, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not build that board." }, { status: 500 });
  }
}
