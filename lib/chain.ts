import { POT_SUPPLY, type PotMeta } from "./types";
import potsData from "../data/pots.json";

// Pot art and traits come from data/pots.json (drawn by scripts/gen-pots.mjs).
// Who owns which Pot is read from Portaldot's native NFT pallet (lib/native.ts).

const byId = new Map<number, PotMeta>((potsData as PotMeta[]).map((c) => [c.id, c]));

export async function getPotMeta(id: number): Promise<PotMeta> {
  const m = byId.get(id);
  if (!m) throw new Error(`Unknown Pot id ${id}`);
  return m;
}

export function isPotId(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= POT_SUPPLY;
}

// Pot numbers the 0x wallet holds on Portaldot. Loaded lazily so pages that never ask about
// owners do not open a connection to the chain.
export async function getOwnedPots(address: string): Promise<number[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return [];
  const { potsOfWallet } = await import("./native");
  return potsOfWallet(address);
}

export async function holdsAnyPot(address: string): Promise<boolean> {
  return (await getOwnedPots(address)).length > 0;
}
