import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { getPoolStore, resolveEvent } from "@/lib/predictions";
import { portaldotPoolChain } from "@/lib/poolPayout";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Backstop timer: closes backing, pays or refunds any event whose race has finished but nobody has looked at
// since, and refunds anything still unsettled after 24 hours. Opening an event page does the same job at once.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!process.env.ESCROW_PRIVATE_KEY) return NextResponse.json({ skipped: "Backing is not switched on." });
  const deps = { store: getPoolStore(), chain: portaldotPoolChain(), races: getStore() };
  const done: { id: string; status: string }[] = [];
  const failed: string[] = [];
  for (const id of await deps.store.listLive()) {
    try {
      const rec = await resolveEvent(deps, id);
      if (rec && (rec.status === "settled" || rec.status === "refunded")) done.push({ id, status: rec.status });
    } catch (e) {
      failed.push(id);
      console.error("pool timer failed", id, e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ done, failed });
}
