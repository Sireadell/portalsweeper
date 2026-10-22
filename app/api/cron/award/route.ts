import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { addDays, isValidDate, utcToday } from "@/lib/salt";
import { awardDay } from "@/lib/award";
import { mintPot, potOwners } from "@/lib/native";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by the Vercel timer (vercel.json), just after midnight UTC: mints yesterday's
// Pot of the day to the fastest ranked clear. ?date=YYYY-MM-DD re-runs an earlier day.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const asked = new URL(req.url).searchParams.get("date");
  const date = asked ?? addDays(utcToday(), -1);
  if (!isValidDate(date) || date >= utcToday()) return NextResponse.json({ error: "Pick a finished day." }, { status: 400 });
  const out = await awardDay(
    {
      store: getStore(),
      mint: (id, wallet) => mintPot(id, wallet),
      ownerOf: async (id) => (await potOwners([id])).get(id) ?? null,
    },
    date,
  );
  return NextResponse.json(out, { status: out.status === "failed" ? 500 : 200 });
}
