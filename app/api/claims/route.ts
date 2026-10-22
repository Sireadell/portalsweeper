import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";

export const dynamic = "force-dynamic";

// Every Pot won so far: who won it, on which day, and the native mint on Portaldot.
export async function GET() {
  try {
    const claims = (await getStore().claimList()).sort((a, b) => b.date.localeCompare(a.date) || a.tokenId - b.tokenId);
    return NextResponse.json(claims, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the claimed Pots." }, { status: 500 });
  }
}
