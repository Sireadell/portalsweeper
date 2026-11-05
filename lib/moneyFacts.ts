// Real counts for the /money page. Each one is read at request time from the chain or the game's own records.
// A read that fails comes back as null, so the page says "could not read just now" and never invents a number.
import { createPublicClient, http, type Hex } from "viem";
import { portaldot } from "./portaldot";
import { getKv } from "./shardKv";
import { burnedKey } from "./shardAward";
import { mintedPortalIds, shardSupply } from "./shardChain";
import { escrowWalletAddress } from "./poolPayout";
import { counted, getPoolStore, potOf, poolCutBps, treasuryAddress, type PoolEvent } from "./predictions";
import { formatTpot } from "./stakes";
import { PORTAL_SUPPLY } from "./types";

export type MoneyFacts = {
  portalsMinted: number | null;
  portalSupply: number;
  shardIssued: number | null;
  shardBurned: number | null;
  poolsPaid: number | null; // pools that paid winners
  poolsRefunded: number | null;
  tpotThroughPools: string | null; // all coins that were backed in pools that have ended
  tpotCutCollected: string | null;
  cutPercentNow: number;
  treasury: string | null;
  treasuryIsPoolWallet: boolean;
  treasuryBalanceTpot: string | null;
};

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}

// Totals over a list of pool records. Only pools that have ended count, and only backs that joined the pool.
export function poolTotals(recs: PoolEvent[]): { paid: number; refunded: number; throughWei: bigint; cutWei: bigint } {
  let paid = 0;
  let refunded = 0;
  let throughWei = 0n;
  let cutWei = 0n;
  for (const r of recs) {
    if (r.status === "settled") paid++;
    else if (r.status === "refunded") refunded++;
    else continue;
    throughWei += potOf({ ...r, backs: counted(r) });
    if (r.cutWei) cutWei += BigInt(r.cutWei);
  }
  return { paid, refunded, throughWei, cutWei };
}

export async function moneyFacts(): Promise<MoneyFacts> {
  const kv = getKv();
  const [minted, supply, burned, pools, escrow] = await Promise.all([
    safe(() => mintedPortalIds()),
    safe(() => shardSupply()),
    safe(async () => Number((await kv.get(burnedKey)) ?? 0)),
    safe(() => getPoolStore().listAll()),
    safe(async () => escrowWalletAddress()),
  ]);
  const treasury = escrow ? treasuryAddress(escrow) : process.env.TREASURY_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(process.env.TREASURY_ADDRESS.trim()) ? process.env.TREASURY_ADDRESS.trim().toLowerCase() : null;
  const balance = treasury ? await safe(async () => createPublicClient({ chain: portaldot, transport: http() }).getBalance({ address: treasury as Hex })) : null;
  const totals = pools ? poolTotals(pools) : null;
  return {
    portalsMinted: minted ? minted.length : null,
    portalSupply: PORTAL_SUPPLY,
    shardIssued: supply !== null && burned !== null ? supply + burned : null,
    shardBurned: burned,
    poolsPaid: totals ? totals.paid : null,
    poolsRefunded: totals ? totals.refunded : null,
    tpotThroughPools: totals ? formatTpot(totals.throughWei) : null,
    tpotCutCollected: totals ? formatTpot(totals.cutWei) : null,
    cutPercentNow: poolCutBps() / 100,
    treasury,
    treasuryIsPoolWallet: !!escrow && !!treasury && escrow.toLowerCase() === treasury,
    treasuryBalanceTpot: balance !== null ? formatTpot(balance) : null,
  };
}
