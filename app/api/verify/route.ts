import { NextResponse } from "next/server";
import { POT_SUPPLY, PORTALDOT_RPC } from "@/lib/types";
import { dailyCommit, getDailySalt, isRevealable, isValidDate, utcToday } from "@/lib/salt";
import { findCommit } from "@/lib/commits";
import { getPotMeta } from "../_deps";

export const dynamic = "force-dynamic";

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(PORTALDOT_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  return (await r.json()).result;
}

type Chain = { found: boolean; data?: string; from?: string; to?: string; timestamp?: number; txHash?: string; block?: number; error?: string };

// Everything the /verify page needs: the Pot's art data, the revealed salt (finished days only),
// and what Portaldot says was posted for that day. The page does the maths itself in the browser.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const tokenId = Number(q.get("token"));
  const date = q.get("date") ?? "";
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > POT_SUPPLY)
    return NextResponse.json({ error: `Pick a Pot number from 1 to ${POT_SUPPLY}.` }, { status: 400 });
  if (!isValidDate(date)) return NextResponse.json({ error: "Use a date like 2026-10-20." }, { status: 400 });
  if (date > utcToday()) return NextResponse.json({ error: "That day has not started yet." }, { status: 400 });

  const revealed = isRevealable(date);
  const post = await findCommit(date);
  let chain: Chain = { found: false };
  if (post?.txHash) {
    try {
      const tx = await rpc("eth_getTransactionByHash", [post.txHash]);
      if (tx?.blockNumber) {
        const block = await rpc("eth_getBlockByNumber", [tx.blockNumber, false]);
        chain = { found: true, data: tx.input, from: tx.from, to: tx.to, timestamp: Number(BigInt(block.timestamp)), txHash: post.txHash, block: Number(BigInt(tx.blockNumber)) };
      } else chain = { found: false, txHash: post.txHash, error: "Portaldot did not return that transaction." };
    } catch {
      chain = { found: false, txHash: post.txHash, error: "Could not reach Portaldot just now." };
    }
  }
  let meta = null;
  try {
    meta = await getPotMeta(tokenId);
  } catch {}
  return NextResponse.json(
    { tokenId, date, revealed, commit: dailyCommit(date), salt: revealed ? getDailySalt(date) : null, meta, chain },
    { headers: { "Cache-Control": "no-store" } },
  );
}
