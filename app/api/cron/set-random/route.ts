import { NextResponse } from "next/server";
import { getApi } from "@/lib/native";
import { findCommit } from "@/lib/commits";
import { addDays, utcToday } from "@/lib/salt";
import { readDayRandom, readStoredRandom, saveStoredRandom, usesChainRandom } from "@/lib/chainRandom";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the Vercel timer a few hours after tomorrow's fingerprint is posted. Reads the chain's random number for
// tomorrow (it only exists three epochs, about three hours, after the fingerprint) and saves it. Never runs once the
// day has started, so nobody can pick the number after seeing play.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const date = addDays(utcToday(), 1);
  if (!usesChainRandom(date)) return NextResponse.json({ ok: true, skipped: "Chain random is not switched on for that day.", date });
  if (await readStoredRandom(date)) return NextResponse.json({ ok: true, already: true, date });

  const post = await findCommit(date);
  if (!post?.txHash || !post.block) return NextResponse.json({ error: `No posted fingerprint for ${date} yet.` }, { status: 409 });

  try {
    const r = await readDayRandom(await getApi(), post.block);
    if (!r) return NextResponse.json({ ok: true, waiting: true, date, note: "The chain has not reached the target hour yet." });
    const saved = await saveStoredRandom(date, r);
    return NextResponse.json({ ok: true, date, random: r, saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
