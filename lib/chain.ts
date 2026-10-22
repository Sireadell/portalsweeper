import { PORTAL_SUPPLY, type PortalMeta } from "./types";
import portalsData from "../data/portals.json";

// Portal art and traits come from data/portals.json (drawn by scripts/gen-portals.mjs).
// Who owns which Portal is read from Portaldot's native NFT pallet (lib/native.ts).

const byId = new Map<number, PortalMeta>((portalsData as PortalMeta[]).map((c) => [c.id, c]));

export async function getPortalMeta(id: number): Promise<PortalMeta> {
  const m = byId.get(id);
  if (!m) throw new Error(`Unknown Portal id ${id}`);
  return m;
}

export function isPortalId(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= PORTAL_SUPPLY;
}

// Portal numbers the 0x wallet holds on Portaldot. Loaded lazily so pages that never ask about
// owners do not open a connection to the chain.
export async function getOwnedPortals(address: string): Promise<number[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return [];
  const { portalsOfWallet } = await import("./native");
  return portalsOfWallet(address);
}

export async function holdsAnyPortal(address: string): Promise<boolean> {
  return (await getOwnedPortals(address)).length > 0;
}
