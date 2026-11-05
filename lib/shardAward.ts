// Daily SHARD awards. Only the Challenge of the Day ranked board pays: 1st 10, 2nd 4, 3rd 2 SHARD (16 a day at most).
// Everything else (friend races, practice, the daily Portal board, streaks) pays nothing because two wallets could farm it.
//   - a wallet earns only if it finished a ranked try on an earlier day (waived on the founding day, when nobody has history)
//   - a clear faster than 0.3 seconds per safe tile is held back, listed, and not paid
//   - 1st place is only paid when the ledger contract holds the same wallet as that day's winner
//   - the whole day settles in ONE chain transaction, and only once per date
import { rankCotd, type CotdEntry, type PortalClaim, type RecordStore, type StoredMove } from "./records";
import { portalOfDay } from "./cotd";
import { moveLogHash } from "./winProof";
import { awardNoteText } from "./shardBatch";
import type { Kv } from "./shardKv";

export const SHARD_PRIZES = [10, 4, 2] as const;
export const MAX_SHARD_PER_DAY = 16;
export const MIN_SECONDS_PER_SAFE_TILE = 0.3;
export const SHARD_SUPPLY_CAP = 50_000; // 500 Portals x 100 SHARD
export const FOUNDING_DAY = "2026-11-05"; // the first Portal goes to this day's winner, with SHARD

export type HeldReason = "too-fast" | "no-history" | "ledger-mismatch" | "supply-cap";
export type Held = { date: string; wallet: string; boardRank: number; seconds: number; reason: HeldReason; detail: string };
export type AwardRow = { place: number; wallet: string; amount: number; seconds: number; fingerprint: string; portal?: number };
export type DayState = {
  date: string;
  status: "sending" | "done" | "failed";
  at: number;
  rows: AwardRow[];
  held: Held[];
  txHash?: string;
  block?: number;
  error?: string;
  founding?: boolean;
  portalSkipped?: string;
};

export const awardKey = (date: string) => `shard:award:${date}`;
export const burnedKey = "shard:burned"; // SHARD burned by redeems, so the ever-issued total can be worked out
export const datesKey = "shard:dates"; // JSON list of dates that have an award record

// Pure-ish: which board entries are paid and which are held. Held and ineligible clears are skipped, so the next
// qualifying clear moves up a place. History is looked up lazily, only for clears that could place.
export async function planPlaces(
  ranked: CotdEntry[],
  date: string,
  look: { safeTiles: (e: CotdEntry) => Promise<number>; hasHistory: (wallet: string) => Promise<boolean> },
  opts: { waiveHistory: boolean },
): Promise<{ paid: { place: number; entry: CotdEntry; amount: number }[]; held: Held[] }> {
  const paid: { place: number; entry: CotdEntry; amount: number }[] = [];
  const held: Held[] = [];
  for (let i = 0; i < ranked.length && paid.length < SHARD_PRIZES.length; i++) {
    const e = ranked[i];
    const tiles = await look.safeTiles(e);
    const base = { date, wallet: e.wallet, boardRank: i + 1, seconds: e.seconds! };
    if (tiles > 0 && e.seconds! < tiles * MIN_SECONDS_PER_SAFE_TILE) {
      held.push({ ...base, reason: "too-fast", detail: `${e.seconds}s for ${tiles} safe tiles is under ${MIN_SECONDS_PER_SAFE_TILE}s a tile` });
      continue;
    }
    if (!opts.waiveHistory && !(await look.hasHistory(e.wallet))) {
      held.push({ ...base, reason: "no-history", detail: "no finished ranked try on an earlier day" });
      continue;
    }
    paid.push({ place: paid.length + 1, entry: e, amount: SHARD_PRIZES[paid.length] });
  }
  return { paid, held };
}

export type AwardShardDeps = {
  store: RecordStore;
  kv: Kv;
  now?: () => number;
  safeTiles: (e: CotdEntry) => Promise<number>;
  moves: (e: CotdEntry) => Promise<StoredMove[]>;
  playedBefore: (wallet: string, date: string) => Promise<boolean>;
  portalOwner: (id: number) => Promise<string | null>;
  shardSupply: () => Promise<number>; // SHARD that exists right now on the chain
  // Settles the day in one transaction. `portal` is set on the founding day only.
  send: (o: { date: string; rows: AwardRow[]; portal: number | null }) => Promise<{ txHash: string; block: number }>;
  // Optional ledger check for 1st place. recordWinner writes it; ledgerWinner reads who the ledger holds (null when none).
  recordWinner?: (date: string, tokenId: number, entry: CotdEntry) => Promise<string | null>;
  ledgerWinner?: (date: string) => Promise<string | null>;
};

export type ShardOutcome =
  | { status: "no-winner"; date: string }
  | { status: "paid"; state: DayState }
  | { status: "already"; state: DayState }
  | { status: "busy"; state: DayState }
  | { status: "nothing-to-pay"; state: DayState }
  | { status: "failed"; date: string; error: string };

async function addDate(kv: Kv, date: string) {
  const list: string[] = JSON.parse((await kv.get(datesKey)) ?? "[]");
  if (!list.includes(date)) await kv.set(datesKey, JSON.stringify([...list, date].sort()));
}

export async function awardShardDay(deps: AwardShardDeps, date: string, opts: { founding?: boolean } = {}): Promise<ShardOutcome> {
  const now = deps.now ?? Date.now;
  const founding = opts.founding ?? date === FOUNDING_DAY;
  const ranked = rankCotd(await deps.store.cotdEntries(date));
  if (ranked.length === 0) return { status: "no-winner", date };

  // One award per date, ever. A finished or running day is never started again; a failed one may be retried.
  const key = awardKey(date);
  const fresh: DayState = { date, status: "sending", at: now(), rows: [], held: [], founding };
  if (!(await deps.kv.setnx(key, JSON.stringify(fresh)))) {
    const cur = JSON.parse((await deps.kv.get(key)) ?? "null") as DayState | null;
    if (cur && cur.status === "done") return { status: "already", state: cur };
    if (cur && cur.status === "sending") return { status: "busy", state: cur };
    await deps.kv.set(key, JSON.stringify(fresh)); // failed earlier: try again
  }
  const save = (s: DayState) => deps.kv.set(key, JSON.stringify(s));

  try {
    const plan = await planPlaces(ranked, date, { safeTiles: deps.safeTiles, hasHistory: (w) => deps.playedBefore(w, date) }, { waiveHistory: founding });
    const held = [...plan.held];
    let paid = plan.paid;

    // 1st place: the ledger contract must hold the same wallet as the day's winner.
    const tokenId = await portalOfDay(deps.store, date);
    if (paid.length > 0 && deps.ledgerWinner) {
      const first = paid[0];
      try {
        if (deps.recordWinner && !(await deps.ledgerWinner(date))) await deps.recordWinner(date, tokenId, first.entry);
      } catch {
        /* the check below decides */
      }
      const onLedger = await deps.ledgerWinner(date);
      if (!onLedger || onLedger.toLowerCase() !== first.entry.wallet.toLowerCase()) {
        held.push({ date, wallet: first.entry.wallet, boardRank: ranked.indexOf(first.entry) + 1, seconds: first.entry.seconds!, reason: "ledger-mismatch", detail: onLedger ? `the ledger holds ${onLedger}` : "the ledger has no winner recorded for this day" });
        paid = paid.slice(1); // the held 1st place is not paid; lower places keep their own prize
      }
    }

    // Never let SHARD ever issued pass the cap (what exists now plus what redeems already burned).
    const burned = Number((await deps.kv.get(burnedKey)) ?? 0);
    let room = SHARD_SUPPLY_CAP - (await deps.shardSupply()) - burned;
    const capped: typeof paid = [];
    let capHit = false;
    for (const p of paid) {
      if (!capHit && p.amount <= room) {
        capped.push(p);
        room -= p.amount;
      } else {
        capHit = true; // once the cap is reached, lower places are held too
        held.push({ date, wallet: p.entry.wallet, boardRank: ranked.indexOf(p.entry) + 1, seconds: p.entry.seconds!, reason: "supply-cap", detail: "paying this would pass the 50,000 SHARD cap" });
      }
    }

    const rows: AwardRow[] = [];
    for (const p of capped) rows.push({ place: p.place, wallet: p.entry.wallet, amount: p.amount, seconds: p.entry.seconds!, fingerprint: moveLogHash(await deps.moves(p.entry)) });
    if (held.length) await deps.kv.set(`shard:held:${date}`, JSON.stringify(held));
    if (rows.length === 0) {
      const state: DayState = { ...fresh, status: "done", rows, held };
      await save(state);
      await addDate(deps.kv, date);
      return { status: "nothing-to-pay", state };
    }

    // Founding day: the winner also gets that day's Portal, unless someone already owns that number.
    let portal: number | null = null;
    let portalSkipped: string | undefined;
    // Off unless FOUNDING_PORTAL=1: a Portal is bought with 100 SHARD, never handed out for a win.
    if (founding && process.env.FOUNDING_PORTAL === "1" && rows[0].place === 1) {
      if (await deps.portalOwner(tokenId)) portalSkipped = `Portal #${tokenId} is already owned, so only SHARD was paid`;
      else {
        portal = tokenId;
        rows[0].portal = tokenId;
      }
    }

    const { txHash, block } = await deps.send({ date, rows, portal });
    const state: DayState = { ...fresh, status: "done", rows, held, txHash, block, portalSkipped };
    await save(state);
    await addDate(deps.kv, date);
    if (portal !== null) {
      const claim: PortalClaim = { tokenId: portal, wallet: rows[0].wallet, date, at: now(), status: "minted", txHash, block };
      const lock = await deps.store.claimLock(claim);
      if (!lock.ok) await deps.store.claimSave({ ...lock.claim, status: "minted", txHash, block });
    }
    return { status: "paid", state };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Award failed.";
    // A timeout may still have landed, so it stays "sending" and needs a look at the chain; any other error can be retried.
    if (/timed out/i.test(error)) await save({ ...fresh, error });
    else await save({ ...fresh, status: "failed", error });
    return { status: "failed", date, error };
  }
}

export async function readDayState(kv: Kv, date: string): Promise<DayState | null> {
  const raw = await kv.get(awardKey(date));
  return raw ? (JSON.parse(raw) as DayState) : null;
}

export async function recentAwards(kv: Kv, n = 7): Promise<DayState[]> {
  const dates: string[] = JSON.parse((await kv.get(datesKey)) ?? "[]");
  const out: DayState[] = [];
  for (const d of dates.slice(-n).reverse()) {
    const s = await readDayState(kv, d);
    if (s) out.push(s);
  }
  return out;
}

export const noteFor = (date: string, r: AwardRow) => awardNoteText(date, r.place, r.fingerprint);
