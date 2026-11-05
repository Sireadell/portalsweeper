import { NextResponse } from "next/server";
import { redeem } from "@/lib/redeem";
import { getKv } from "@/lib/shardKv";
import { portalOwnerOf, sendRedeem, shardBalanceOf } from "@/lib/shardChain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// { address, signature, portal, issuedAt }: the player signed "redeem 100 SHARD for Portal N" (free). One issuer transaction does the rest.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const out = await redeem(
    { kv: getKv(), portalOwner: portalOwnerOf, shardBalance: shardBalanceOf, send: sendRedeem },
    { address: b.address, signature: b.signature, portal: b.portal, issuedAt: b.issuedAt },
  );
  if (out.ok) return NextResponse.json(out);
  return NextResponse.json({ error: out.error }, { status: out.status });
}
