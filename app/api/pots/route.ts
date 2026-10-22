import { NextResponse } from "next/server";
import { POT_SUPPLY, type PotMeta } from "@/lib/types";
import { getPotMeta, getOwnedPots } from "@/lib/chain";

export const dynamic = "force-dynamic";

// Keeps the big metadata file on the server. ?id=N gives one Pot, ?owner=0x.. gives the Pots a wallet holds.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const owner = q.get("owner");
    if (owner) {
      const ids = await getOwnedPots(owner);
      const metas: PotMeta[] = await Promise.all(ids.map((id) => getPotMeta(id)));
      return NextResponse.json(metas, { headers: { "Cache-Control": "no-store" } });
    }
    const id = Number(q.get("id"));
    if (!Number.isInteger(id) || id < 1 || id > POT_SUPPLY)
      return NextResponse.json({ error: `Pick a Pot number from 1 to ${POT_SUPPLY}.` }, { status: 400 });
    return NextResponse.json(await getPotMeta(id), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Could not load that Pot." }, { status: 500 });
  }
}
