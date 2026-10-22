import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { utcToday } from "@/lib/salt";
import { cleanIds, streakFor } from "@/lib/streaks";

export const dynamic = "force-dynamic";

// ?ids=1,2,3 (the Portals the wallet holds) and optional &address=0x.. for Portal of the day wins.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const address = q.get("address");
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "Bad address." }, { status: 400 });
  try {
    const s = await streakFor(getStore(), cleanIds(q.get("ids")), address, utcToday());
    return NextResponse.json(s, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read streaks." }, { status: 500 });
  }
}
