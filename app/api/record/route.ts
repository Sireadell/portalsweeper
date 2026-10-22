import { NextResponse } from "next/server";
import { POT_SUPPLY } from "@/lib/types";
import { getStore } from "@/lib/records";
import { utcToday } from "@/lib/salt";

export const dynamic = "force-dynamic";

function goodToken(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= POT_SUPPLY;
}

export async function GET(req: Request) {
  const tokenId = Number(new URL(req.url).searchParams.get("tokenId"));
  if (!goodToken(tokenId)) return NextResponse.json({ error: `Pick a Pot number from 1 to ${POT_SUPPLY}.` }, { status: 400 });
  return NextResponse.json(await getStore().getRecord(tokenId), { headers: { "Cache-Control": "no-store" } });
}

// One result per Pot per day. Only today's result is accepted so streaks stay honest.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const { tokenId, date, won, seconds } = b;
  const moves = Array.isArray(b.moves) ? b.moves.length : b.moves;
  if (!goodToken(tokenId)) return NextResponse.json({ error: "Unknown Pot." }, { status: 400 });
  if (date !== utcToday()) return NextResponse.json({ error: "Only today's board can be recorded." }, { status: 400 });
  if (typeof won !== "boolean") return NextResponse.json({ error: "won must be true or false." }, { status: 400 });
  if (typeof seconds !== "number" || !(seconds >= 0 && seconds <= 86_400))
    return NextResponse.json({ error: "seconds is out of range." }, { status: 400 });
  if (typeof moves !== "number" || !Number.isInteger(moves) || moves < 0 || moves > 100_000)
    return NextResponse.json({ error: "moves is out of range." }, { status: 400 });
  const out = await getStore().submit({ tokenId, date, won, seconds: Math.round(seconds * 10) / 10, moves });
  if (!out.ok) return NextResponse.json({ error: "This Pot already played today.", record: out.record }, { status: 409 });
  return NextResponse.json(out.record);
}
