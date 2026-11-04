import type { ApiPromise } from "@polkadot/api";
import type { Hex } from "viem";
import { readStoredJson, saveStoredJson } from "./commits";

// The chain's own random number for a day.
//
// Rule: the day's fingerprint is posted in block C, which sits in epoch e (an epoch is one hour, 600 blocks). The
// day's chain number is `babe.randomness` as it stands in epoch e + 3. It is built from block producers' random
// output in epochs after the fingerprint was posted, so nobody could know it when the fingerprint was made.
// Portaldot V3 testnet has only 2 validators, so this is not trustless: a validator could nudge it.
export const EPOCHS_AHEAD = 3;

export type DayRandom = { value: Hex; block: number; epoch: number; commitBlock: number };

// Days on or after RANDOM_FROM (YYYY-MM-DD, set on the server) use the chain number. Without it every day uses
// the original board, so nothing changes for days already played.
export function usesChainRandom(date: string, from: string | undefined = process.env.RANDOM_FROM): boolean {
  return !!from && /^\d{4}-\d{2}-\d{2}$/.test(from) && date >= from;
}

// First block in [lo, hi] whose epoch is at least `target`, or null when even `hi` is earlier. epochAt must not go down as blocks go up.
export async function firstBlockOfEpoch(epochAt: (block: number) => Promise<number>, lo: number, hi: number, target: number): Promise<number | null> {
  if ((await epochAt(hi)) < target) return null;
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = Math.floor((a + b) / 2);
    if ((await epochAt(mid)) >= target) b = mid;
    else a = mid + 1;
  }
  return a;
}

// Reads the day's chain number straight from the chain. Returns null until epoch e + 3 has started.
export async function readDayRandom(api: ApiPromise, commitBlock: number): Promise<DayRandom | null> {
  const epochAt = async (n: number) => {
    const at = await api.at(await api.rpc.chain.getBlockHash(n));
    return Number((await at.query.babe.epochIndex()).toString());
  };
  const head = (await api.rpc.chain.getHeader()).number.toNumber();
  const commitEpoch = await epochAt(commitBlock);
  const target = commitEpoch + EPOCHS_AHEAD;
  const block = await firstBlockOfEpoch(epochAt, commitBlock, head, target);
  if (block === null) return null;
  const at = await api.at(await api.rpc.chain.getBlockHash(block));
  const value = (await at.query.babe.randomness()).toHex() as Hex;
  return { value, block, epoch: target, commitBlock };
}

export const randomKey = (date: string) => `random:${date}`;
export const readStoredRandom = (date: string) => readStoredJson<DayRandom>(randomKey(date));
export const saveStoredRandom = (date: string, r: DayRandom) => saveStoredJson(randomKey(date), r);
