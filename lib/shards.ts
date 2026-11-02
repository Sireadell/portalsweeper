// Shards: one for each weekday you clear a ranked board. Collect all seven to complete a set.
// Two of the seven (Saturday and Sunday) only drop from a hard clear: a Rare or bigger Portal,
// any twist, or a friend challenge win. Shards are never lost, so a missed weekday can be made
// up the next week. Kept in this browser for now.
import type { TwistId } from "./twists";
import { isHardTwist } from "./twists";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const HARD_DAYS = [5, 6]; // Saturday, Sunday
export const SET_SIZE = 7;
const HARD_TIERS = ["Rare", "Epic", "Legendary"];

export type Shard = { date: string; tokenId: number; hard: boolean };
export type ShardState = { got: Partial<Record<number, Shard>> };
export const emptyShards = (): ShardState => ({ got: {} });

// Monday is 0, Sunday is 6, read in UTC to match the daily board.
export function weekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d + 6) % 7;
}

export function isHardClear(o: { tier: string | undefined; twist: TwistId; friendWin?: boolean }): boolean {
  return !!o.friendWin || isHardTwist(o.twist) || (!!o.tier && HARD_TIERS.includes(o.tier));
}

export type ClearInfo = { date: string; tokenId: number; won: boolean; ranked: boolean; tier: string | undefined; twist: TwistId; friendWin?: boolean };
export type ShardResult = { state: ShardState; earned: number | null; blockedHard: boolean };

// Returns the new state, the weekday earned (or null), and whether a weekend shard was
// withheld because the clear was not hard enough (so the screen can say why).
export function recordClear(prev: ShardState, c: ClearInfo): ShardResult {
  if (!c.won || !c.ranked) return { state: prev, earned: null, blockedHard: false };
  const day = weekdayOf(c.date);
  if (prev.got[day]) return { state: prev, earned: null, blockedHard: false };
  const hard = isHardClear(c);
  if (HARD_DAYS.includes(day) && !hard) return { state: prev, earned: null, blockedHard: true };
  return { state: { got: { ...prev.got, [day]: { date: c.date, tokenId: c.tokenId, hard } } }, earned: day, blockedHard: false };
}

export const shardCount = (s: ShardState) => Object.keys(s.got).length;
export const setComplete = (s: ShardState) => shardCount(s) >= SET_SIZE;

const KEY = "portalsweeper:shards";
export function loadShards(): ShardState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyShards();
    const p = JSON.parse(raw) as ShardState;
    return p && typeof p.got === "object" ? p : emptyShards();
  } catch { return emptyShards(); }
}
export function saveShards(s: ShardState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ }
}
