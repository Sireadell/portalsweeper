import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { addDays, isValidDate, utcToday } from "@/lib/salt";
import { awardDay, awardStuck, type AwardDeps } from "@/lib/award";
import { mintPortal, portalOwners } from "@/lib/native";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by the Vercel timer (vercel.json), just after midnight UTC: mints yesterday's
// Portal of the day to the fastest ranked clear. ?date=YYYY-MM-DD re-runs an earlier day.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const asked = new URL(req.url).searchParams.get("date");
  const date = asked ?? addDays(utcToday(), -1);
  if (!isValidDate(date) || date >= utcToday()) return NextResponse.json({ error: "Pick a finished day." }, { status: 400 });
  const deps: AwardDeps = {
    store: getStore(),
    mint: (id, wallet) => mintPortal(id, wallet),
    ownerOf: async (id) => (await portalOwners([id])).get(id) ?? null,
  };
  try {
    const out = await awardDay(deps, date);
    // On the normal daily run also finish any earlier day whose mint failed.
    const retried = asked ? [] : await awardStuck(deps, utcToday(), date);
    const failed = out.status === "failed" || retried.some((r) => r.status === "failed");
    console.log("award", JSON.stringify({ out, retried }));
    if (failed) console.error("award failed", JSON.stringify({ out, retried }));
    return NextResponse.json({ ...out, retried }, { status: failed ? 500 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Award failed.";
    console.error("award crashed", error);
    return NextResponse.json({ status: "failed", date, error }, { status: 500 });
  }
}
