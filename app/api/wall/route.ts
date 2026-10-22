import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { clearedIds } from "@/lib/streaks";
import { PORTAL_SUPPLY } from "@/lib/types";

export const dynamic = "force-dynamic";

// Real list of Portals that have been cleared at least once, by anyone.
export async function GET() {
  try {
    return NextResponse.json({ total: PORTAL_SUPPLY, cleared: await clearedIds(getStore()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read the wall." }, { status: 500 });
  }
}
