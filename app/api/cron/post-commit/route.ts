import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot as chain } from "@/lib/portaldot";
import { addDays, dailyCommit, utcToday } from "@/lib/salt";
import { commitToLedger, ledgerAddress, readLedgerDay, revealToLedger } from "@/lib/ledger";
import { findCommit, saveStoredPost } from "@/lib/commits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by the Vercel timer (vercel.json). Posts the day's fingerprint to Portaldot from the
// small poster wallet and remembers the transaction so /verify can show it.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const key = process.env.POSTER_PRIVATE_KEY;
  if (!key) return NextResponse.json({ error: "No poster wallet is set up on the server." }, { status: 500 });

  // ?ahead=1 posts tomorrow's fingerprint, so the chain can make its random number for that day before play starts.
  const date = new URL(req.url).searchParams.get("ahead") === "1" ? addDays(utcToday(), 1) : utcToday();
  const existing = await findCommit(date);
  if (existing?.txHash) return NextResponse.json({ ok: true, already: true, date, txHash: existing.txHash });

  const account = privateKeyToAccount((key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}`) as Hex);
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });

  try {
    if ((await pub.getBalance({ address: account.address })) === 0n)
      return NextResponse.json({ error: `The poster wallet ${account.address} has no tPOT. Send it a little.` }, { status: 500 });
    const commit = dailyCommit(date);
    // With the ledger contract set up, the fingerprint goes there. If that is not set up, or the call fails,
    // the plain note below is sent as before, so a day is never left without a fingerprint on the chain.
    let hash: Hex | null = null;
    let kind: "note" | "ledger" = "note";
    if (ledgerAddress()) {
      try {
        hash = await commitToLedger(date, wallet, pub);
        if (hash) kind = "ledger";
      } catch {
        hash = null;
      }
    }
    if (!hash) {
      hash = await wallet.sendTransaction({ to: account.address, value: 0n, data: commit });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return NextResponse.json({ error: `The post failed: ${hash}` }, { status: 500 });
    }
    const block = Number((await pub.getTransactionReceipt({ hash })).blockNumber);
    const saved = await saveStoredPost({ date, commit, txHash: hash, block, kind });
    // Reveal yesterday's secret to the contract, which checks it against yesterday's fingerprint. Never blocks the post.
    let revealed: Hex | null = null;
    if (kind === "ledger") {
      try {
        const yesterday = addDays(date, -1);
        const day = await readLedgerDay(yesterday, pub);
        if (day?.commit && !day.revealed) revealed = await revealToLedger(yesterday, wallet, pub);
      } catch {}
    }
    return NextResponse.json({ ok: true, date, kind, txHash: hash, block, saved, revealed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
