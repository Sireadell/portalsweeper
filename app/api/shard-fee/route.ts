import { NextResponse } from "next/server";
import { getApi, recipientAccount } from "@/lib/native";
import { feeAssetOption, quoteShardFee, shardFeesOn, canPayInShard } from "@/lib/shardFee";
import { shardBalanceOf } from "@/lib/shardChain";

export const dynamic = "force-dynamic";

// What a fee costs in SHARD for one native account, and the signing option to use. Off unless SHARD_FEES=1.
export async function GET(req: Request) {
  if (!shardFeesOn()) return NextResponse.json({ on: false }, { status: 404 });
  const from = new URL(req.url).searchParams.get("from") ?? "";
  let account: string;
  try {
    account = recipientAccount(from);
  } catch {
    return NextResponse.json({ error: "Give a valid Portaldot account in ?from=" }, { status: 400 });
  }
  const quote = await quoteShardFee(await getApi(), account);
  const balance = await shardBalanceOf(account);
  return NextResponse.json({ on: true, account, quote, balance, canPay: canPayInShard(balance, quote), sign: feeAssetOption() }, { headers: { "Cache-Control": "no-store" } });
}
