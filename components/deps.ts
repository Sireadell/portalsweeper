// Browser-side access to the engine and the Portal data. The metadata file stays on the
// server (app/api/portals), so lib/chain is never pulled into the client bundle.
import type { PortalMeta } from "@/lib/types";
export { generateBoard, saltCommit } from "@/lib/engine";

export async function getPortalMeta(id: number): Promise<PortalMeta> {
  const r = await fetch(`/api/portals?id=${id}`);
  if (!r.ok) throw new Error("no portal");
  return r.json();
}

export async function getOwnedPortalMetas(address: string): Promise<PortalMeta[]> {
  const r = await fetch(`/api/portals?owner=${address}`, { cache: "no-store" });
  if (!r.ok) throw new Error("no portals");
  return r.json();
}
