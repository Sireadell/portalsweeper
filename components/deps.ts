// Browser-side access to the engine and the Pot data. The metadata file stays on the
// server (app/api/pots), so lib/chain is never pulled into the client bundle.
import type { PotMeta } from "@/lib/types";
export { generateBoard, saltCommit } from "@/lib/engine";

export async function getPotMeta(id: number): Promise<PotMeta> {
  const r = await fetch(`/api/pots?id=${id}`);
  if (!r.ok) throw new Error("no pot");
  return r.json();
}

export async function getOwnedPotMetas(address: string): Promise<PotMeta[]> {
  const r = await fetch(`/api/pots?owner=${address}`, { cache: "no-store" });
  if (!r.ok) throw new Error("no pots");
  return r.json();
}
