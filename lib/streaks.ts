import { addDays } from "./salt";
import { PORTAL_SUPPLY } from "./types";
import type { PortalRecord, RecordStore } from "./records";

export type WalletStreak = {
  current: number;
  best: number;
  clearedToday: boolean;
  // A streak is alive but today's board is not cleared yet: clear today to keep it.
  atRisk: boolean;
};

// The days covered by a Portal's current run of wins. A run only exists while currentStreak is
// above zero, and then lastDate is the day of the latest win.
export function runDays(rec: PortalRecord): string[] {
  if (rec.currentStreak <= 0 || !rec.lastDate) return [];
  const out: string[] = [];
  for (let i = 0; i < rec.currentStreak; i++) out.push(addDays(rec.lastDate, -i));
  return out;
}

// Longest stretch of consecutive days inside a set of win days.
export function longestRun(days: Set<string>): number {
  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // not the start of a stretch
    let n = 1;
    while (days.has(addDays(d, n))) n++;
    best = Math.max(best, n);
  }
  return best;
}

// Wallet streak = consecutive UTC days with at least one cleared ranked board across the Portals
// the wallet holds. `extraWinDays` carries days known from other sources (Portal of the day wins).
// Today not cleared yet does not break a streak until the day is over. Best is a floor: it
// takes the largest of each Portal's own best and the longest stretch we can still see.
export function walletStreak(records: PortalRecord[], today: string, extraWinDays: Iterable<string> = []): WalletStreak {
  const days = new Set<string>(extraWinDays);
  for (const r of records) for (const d of runDays(r)) days.add(d);
  const clearedToday = days.has(today);
  let cursor = clearedToday ? today : addDays(today, -1);
  let current = 0;
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const best = Math.max(current, longestRun(days), ...records.map((r) => r.longestStreak));
  return { current, best, clearedToday, atRisk: current > 0 && !clearedToday };
}

export function cleanIds(raw: string | null, max = 300): number[] {
  const ids = (raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= PORTAL_SUPPLY);
  return [...new Set(ids)].slice(0, max);
}

// Reads the store through its existing interface only.
export async function streakFor(store: RecordStore, ids: number[], address: string | null, today: string, lookbackDays = 30): Promise<WalletStreak> {
  const records = await Promise.all(ids.map((id) => store.getRecord(id)));
  const extra: string[] = [];
  if (address) {
    const w = address.toLowerCase();
    const dates = Array.from({ length: lookbackDays }, (_, i) => addDays(today, -i));
    const found = await Promise.all(dates.map((d) => store.cotdEntry(d, w).catch(() => null)));
    found.forEach((e, i) => { if (e?.won) extra.push(dates[i]); });
  }
  return walletStreak(records, today, extra);
}

// Every Portal that anyone has ever cleared, from the real records.
export async function clearedIds(store: RecordStore): Promise<number[]> {
  return (await store.listRecords()).filter((r) => r.wins > 0).map((r) => r.tokenId).sort((a, b) => a - b);
}
