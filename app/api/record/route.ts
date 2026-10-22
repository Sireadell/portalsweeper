import { NextResponse } from "next/server";
import { PORTAL_SUPPLY } from "@/lib/types";
import { getStore } from "@/lib/records";

export const dynamic = "force-dynamic";

function goodToken(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= PORTAL_SUPPLY;
}

export async function GET(req: Request) {
  const tokenId = Number(new URL(req.url).searchParams.get("tokenId"));
  if (!goodToken(tokenId)) return NextResponse.json({ error: `Pick a Portal number from 1 to ${PORTAL_SUPPLY}.` }, { status: 400 });
  return NextResponse.json(await getStore().getRecord(tokenId), { headers: { "Cache-Control": "no-store" } });
}

// Results are no longer posted here: the server records a day itself when the game ends (see /api/board).
