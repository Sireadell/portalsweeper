import { NextResponse } from "next/server";
import { PORTAL_SUPPLY, type PortalMeta } from "@/lib/types";
import { getPortalMeta, getOwnedPortals } from "@/lib/chain";

export const dynamic = "force-dynamic";

// Keeps the big metadata file on the server. ?id=N gives one Portal, ?owner=0x.. gives the Portals a wallet holds.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const owner = q.get("owner");
    if (owner) {
      const ids = await getOwnedPortals(owner);
      const metas: PortalMeta[] = await Promise.all(ids.map((id) => getPortalMeta(id)));
      return NextResponse.json(metas, { headers: { "Cache-Control": "no-store" } });
    }
    const id = Number(q.get("id"));
    if (!Number.isInteger(id) || id < 1 || id > PORTAL_SUPPLY)
      return NextResponse.json({ error: `Pick a Portal number from 1 to ${PORTAL_SUPPLY}.` }, { status: 400 });
    return NextResponse.json(await getPortalMeta(id), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Could not load that Portal." }, { status: 500 });
  }
}
