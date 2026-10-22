import { NextResponse } from "next/server";
import { dailyCommit, getDailySalt, isRevealable, isValidDate, utcToday } from "@/lib/salt";

export const dynamic = "force-dynamic";

// Fingerprint any time; the salt itself only once the UTC day is over.
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? utcToday();
  if (!isValidDate(date)) return NextResponse.json({ error: "Use a date like 2026-10-20." }, { status: 400 });
  const body: { date: string; commit: string; salt?: string; revealed: boolean } = {
    date,
    commit: dailyCommit(date),
    revealed: isRevealable(date),
  };
  if (body.revealed) body.salt = getDailySalt(date);
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
