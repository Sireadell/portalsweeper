import { NextResponse } from "next/server";
import { getApi } from "@/lib/native";
import { findCommit } from "@/lib/commits";
import { addDays, utcToday } from "@/lib/salt";
import { readDayRandom, readStoredRandom, saveStoredRandom, usesChainRandom } from "@/lib/chainRandom";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function one(date: string) {
  if (!usesChainRandom(date)) return { date, skipped: "Chain random is not switched on for that day." };
  if (await readStoredRandom(date)) return { date, already: true };
  const post = await findCommit(date);
  if (!post?.txHash || !post.block) return { date, waiting: "No posted fingerprint yet." };
  try {
    const r = await readDayRandom(await getApi(), post.block);
    if (!r) return { date, waiting: "The chain has not reached the target hour yet." };
    return { date, random: r, saved: await saveStoredRandom(date, r) };
  } catch (e) {
    return { date, error: e instanceof Error ? e.message : "Failed." };
  }
}

// Called by the Vercel timer every hour. For today and tomorrow it reads the chain's random number (it only exists
// three epochs, about three hours, after that day's fingerprint was posted) and saves it once it is there.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const results = [];
  for (const date of [utcToday(), addDays(utcToday(), 1)]) results.push(await one(date));
  return NextResponse.json({ ok: true, results });
}
