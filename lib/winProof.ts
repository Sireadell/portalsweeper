import { keccak256, toBytes, type Hex } from "viem";
import type { StoredMove } from "./records";

// A fixed text form of a move log, so the same moves always give the same fingerprint: one line per move,
// "action:idx:t", in the order they were played.
export function moveLogText(moves: StoredMove[]): string {
  return moves.map((m) => `${m.action}:${m.idx}:${m.t}`).join("\n");
}

// The fingerprint written to the ledger next to a day's winner. Anyone with the moves can recompute it.
export function moveLogHash(moves: StoredMove[]): Hex {
  return keccak256(toBytes(moveLogText(moves)));
}
