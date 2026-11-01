import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { resolveChallengeStake } from "@/lib/challenge";
import { getStakeStore, stakesEnabled } from "@/lib/stakes";
import { portaldotStakeChain } from "@/lib/stakeChain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Backstop timer (vercel.json): pays or refunds any stake whose challenge has settled but nobody has
// looked at since, such as a link that expired. Opening a challenge page does the same job at once.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!stakesEnabled()) return NextResponse.json({ skipped: "Stakes are not switched on." });
  const stakes = { store: getStakeStore(), chain: portaldotStakeChain() };
  const deps = { store: getStore(), board: async () => { throw new Error("not needed"); }, stakes };
  const done: { id: string; status: string }[] = [];
  const failed: string[] = [];
  for (const id of await stakes.store.listLive()) {
    try {
      const rec = await resolveChallengeStake(deps, id);
      if (rec && (rec.status === "settled" || rec.status === "refunded")) done.push({ id, status: rec.status });
    } catch (e) {
      failed.push(id);
      console.error("stake timer failed", id, e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ done, failed });
}
