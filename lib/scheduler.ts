// Scheduler: ask the chain itself to run a call at a set block. The one honest job would be: at the start of a UTC day the
// chain writes that day's fingerprint note (Remark) on its own, even if our server is asleep. The call is fixed in
// advance, so it can only carry things already known (the fingerprint), never the winner.
// TESTED 2026-11-05: on this chain schedule, scheduleNamed and scheduleAfter all answer BadOrigin to a normal wallet
// (the schedule origin is Root). So only a chain admin (the Sudo key) could run this; we cannot. The code stays so an
// admin can use it, but it is not part of the live flow. See research/B6_B7_B8_findings.md.
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { dayNote, remarkCall } from "./remark";

export const BLOCK_MS = 6000;

// The block that lands at (or just after) a moment, counted from the current head.
export function blockAt(headBlock: number, headTimeMs: number, targetMs: number): number {
  if (targetMs <= headTimeMs) throw new Error("That moment has already passed.");
  return headBlock + Math.ceil((targetMs - headTimeMs) / BLOCK_MS);
}

export const scheduleId = (date: string): Uint8Array => blake2AsU8a(`portalsweeper:day-note:${date}`, 256);

export type ScheduleInput = { date: string; commit: string; headBlock: number; headTimeMs: number; atMs?: number };

// Schedules the day's note for the first block of that UTC day (or `atMs`). Named, so it can be cancelled or told apart.
export function scheduleDayNote(api: ApiPromise, i: ScheduleInput): { call: SubmittableExtrinsic<"promise">; when: number } {
  const when = blockAt(i.headBlock, i.headTimeMs, i.atMs ?? Date.parse(`${i.date}T00:00:00Z`));
  const inner = remarkCall(api, dayNote({ date: i.date, commit: i.commit }));
  return { call: api.tx.scheduler.scheduleNamed(scheduleId(i.date), when, null, 0, inner.method), when };
}
