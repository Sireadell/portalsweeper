import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { addDays, isValidDate, utcToday } from "@/lib/salt";
import { awardDay, awardStuck, type AwardDeps } from "@/lib/award";
import { mintPortal, portalOwners } from "@/lib/native";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot as chain } from "@/lib/portaldot";
import { ledgerAddress, recordWinnerToLedger } from "@/lib/ledger";
import { cotdGameKey } from "@/lib/cotd";
import { awardShardDay, type AwardShardDeps } from "@/lib/shardAward";
import { getKv } from "@/lib/shardKv";
import { ledgerWinnerOf, portalOwnerOf, sendAward, shardSupply } from "@/lib/shardChain";
import { getDailySalt } from "@/lib/salt";
import { readStoredRandom, usesChainRandom } from "@/lib/chainRandom";
import { generateBoard, getPortalMeta } from "../../_deps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by the Vercel timer (vercel.json), just after midnight UTC: mints yesterday's
// Portal of the day to the fastest ranked clear. ?date=YYYY-MM-DD re-runs an earlier day.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const asked = new URL(req.url).searchParams.get("date");
  const date = asked ?? addDays(utcToday(), -1);
  if (!isValidDate(date) || date >= utcToday()) return NextResponse.json({ error: "Pick a finished day." }, { status: 400 });
  const store = getStore();
  const deps: AwardDeps = {
    store,
    mint: (id, wallet) => mintPortal(id, wallet),
    ownerOf: async (id) => (await portalOwners([id])).get(id) ?? null,
  };
  // With the ledger set up, the winner and their move log fingerprint are also written to it. Without it, nothing changes.
  const poster = process.env.POSTER_PRIVATE_KEY?.trim();
  if (ledgerAddress() && poster) {
    const account = privateKeyToAccount((poster.startsWith("0x") ? poster : `0x${poster}`) as Hex);
    const wallet = createWalletClient({ account, chain, transport: http() });
    deps.recordWinner = async (claim) =>
      recordWinnerToLedger(claim.date, claim.tokenId, claim.wallet, await store.movesGet(cotdGameKey(claim.date, claim.wallet)), wallet);
  }
  // AWARD_MODE=shard pays the top 3 in SHARD (and on the founding day the winner's Portal too). Anything else keeps the old Portal award.
  if (process.env.AWARD_MODE === "shard") {
    const safeTiles: AwardShardDeps["safeTiles"] = async (e) => {
      const random = usesChainRandom(e.date) ? (await readStoredRandom(e.date))?.value : undefined;
      const b = await generateBoard(await getPortalMeta(e.tokenId), e.date, getDailySalt(e.date), random, e.wallet);
      return b.cols * b.rows - b.mines;
    };
    const shardDeps: AwardShardDeps = {
      store,
      kv: getKv(),
      safeTiles,
      moves: (e) => store.movesGet(cotdGameKey(e.date, e.wallet)),
      playedBefore: async (wallet, d) => {
        for (let i = 1; i <= 30; i++) {
          const prev = await store.cotdEntry(addDays(d, -i), wallet).catch(() => null);
          if (prev?.finishedAt) return true;
        }
        return false;
      },
      portalOwner: portalOwnerOf,
      shardSupply,
      send: sendAward,
    };
    if (deps.recordWinner && ledgerAddress()) {
      const record = deps.recordWinner;
      shardDeps.ledgerWinner = ledgerWinnerOf;
      shardDeps.recordWinner = (d, tokenId, entry) => record({ tokenId, wallet: entry.wallet, date: d, at: Date.now(), status: "minted" });
    }
    try {
      const out = await awardShardDay(shardDeps, date);
      console.log("award shard", JSON.stringify(out));
      return NextResponse.json({ mode: "shard", ...out }, { status: out.status === "failed" ? 500 : 200 });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Award failed.";
      console.error("award shard crashed", error);
      return NextResponse.json({ status: "failed", date, error }, { status: 500 });
    }
  }
  try {
    const out = await awardDay(deps, date);
    // On the normal daily run also finish any earlier day whose mint failed.
    const retried = asked ? [] : await awardStuck(deps, utcToday(), date);
    const failed = out.status === "failed" || retried.some((r) => r.status === "failed");
    console.log("award", JSON.stringify({ out, retried }));
    if (failed) console.error("award failed", JSON.stringify({ out, retried }));
    return NextResponse.json({ ...out, retried }, { status: failed ? 500 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Award failed.";
    console.error("award crashed", error);
    return NextResponse.json({ status: "failed", date, error }, { status: 500 });
  }
}
