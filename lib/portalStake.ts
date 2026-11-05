// Portal for Portal stakes in a race. Each player moves a Portal with their own 0x wallet (Nfts.transfer sent as an
// Ethereum-signed transaction to the runtime pallets address) to the escrow wallet's mapped account. When the race ends the
// escrow wallet sends ONE batch through the same route: both Portals to the winner plus a note, or each Portal back
// to its owner on a draw, cancel or no show. Trusted custody: the game server holds staked Portals until the race ends.
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY } from "./types";

type Call = SubmittableExtrinsic<"promise">;

export function checkPortal(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > PORTAL_SUPPLY) throw new Error(`Portal must be a number from 1 to ${PORTAL_SUPPLY}.`);
}

// What a player signs from their own wallet: move Portal `id` to the escrow's native account.
export function lockCall(api: ApiPromise, id: number, escrowAccount: string, collection = PORTAL_COLLECTION_ID): Call {
  checkPortal(id);
  return api.tx.nfts.transfer(collection, id, escrowAccount);
}

export type PortalPayout = { portal: number; to: string };

// Plain text note for the block's events. Short and readable.
export function portalPayoutNote(code: string, outcome: "win" | "draw" | "cancel", winner?: string): string {
  const w = winner ? ` winner=${winner}` : "";
  return `portalsweeper portal-stake ${code} ${outcome}${w}`.slice(0, 120);
}

// The escrow wallet's one batch: every Portal goes to its target account, then one note. All or nothing.
export function payoutBatch(api: ApiPromise, moves: PortalPayout[], note: string, collection = PORTAL_COLLECTION_ID): Call {
  if (moves.length < 1 || moves.length > 4) throw new Error("A payout moves 1 to 4 Portals.");
  const calls = moves.map((m) => {
    checkPortal(m.portal);
    return api.tx.nfts.transfer(collection, m.portal, m.to);
  });
  calls.push(api.tx.system.remarkWithEvent(note));
  return api.tx.utility.batchAll(calls) as Call;
}

// Who gets which Portal. `entries` are the two seated players with the Portal each locked.
export type PortalEntry = { wallet: string; portal: number };
export type RaceEnd = { kind: "win"; winner: string } | { kind: "draw" } | { kind: "cancel" };

export function payoutPlan(entries: PortalEntry[], end: RaceEnd, mapped: (wallet: string) => string): PortalPayout[] {
  if (entries.length < 1 || entries.length > 2) throw new Error("A race holds one or two staked Portals.");
  if (end.kind === "win") {
    const w = entries.find((e) => e.wallet.toLowerCase() === end.winner.toLowerCase());
    if (!w || entries.length !== 2) return entries.map((e) => ({ portal: e.portal, to: mapped(e.wallet) }));
    return entries.map((e) => ({ portal: e.portal, to: mapped(w.wallet) }));
  }
  return entries.map((e) => ({ portal: e.portal, to: mapped(e.wallet) }));
}
