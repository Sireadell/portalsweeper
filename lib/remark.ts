// An on-chain note for the day, written with Portaldot's Remark module (remark.store). It is a native call, so it
// goes out from a normal 0x wallet through the runtime pallets address (see lib/swap.ts and scripts/test-ethsubstrate.ts).
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { stringToHex } from "@polkadot/util";

export const NOTE_PREFIX = "portalsweeper/1";
const MAX_NOTE_BYTES = 256;

export type DayNote = { date: string; commit: string; winner?: { tokenId: number; wallet: string } | null };

// One short line anyone can read from the chain: the day, its fingerprint and, once known, who cleared it.
export function dayNote(n: DayNote): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date)) throw new Error("date must be YYYY-MM-DD");
  if (!/^0x[0-9a-fA-F]{64}$/.test(n.commit)) throw new Error("commit must be a 32 byte 0x hash");
  const base = `${NOTE_PREFIX} day=${n.date} fingerprint=${n.commit.toLowerCase()}`;
  const text = n.winner ? `${base} portal=${n.winner.tokenId} winner=${n.winner.wallet.toLowerCase()}` : base;
  if (new TextEncoder().encode(text).length > MAX_NOTE_BYTES) throw new Error("note is too long");
  return text;
}

export const remarkCall = (api: ApiPromise, text: string): SubmittableExtrinsic<"promise"> => api.tx.remark.store(stringToHex(text));

// Reads a note back: the parts if it is one of ours, otherwise null.
export function parseNote(text: string): { date: string; commit: string; tokenId?: number; winner?: string } | null {
  const m = text.match(/^portalsweeper\/1 day=(\d{4}-\d{2}-\d{2}) fingerprint=(0x[0-9a-f]{64})(?: portal=(\d+) winner=(0x[0-9a-f]{40}))?$/);
  if (!m) return null;
  return { date: m[1], commit: m[2], ...(m[3] ? { tokenId: Number(m[3]), winner: m[4] } : {}) };
}
