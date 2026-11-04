import { createPublicClient, decodeFunctionData, http, type Hex, type PublicClient, type WalletClient } from "viem";
import artifact from "../contracts/DailyLedger.json";
import { portaldot as chain } from "./portaldot";
import { dailyCommit, getDailySalt } from "./salt";

export const LEDGER_ABI = artifact.abi;

// 2026-11-05 becomes 20261105, the key the DailyLedger contract uses for a day.
export function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date "${date}".`);
  return Number(date.replaceAll("-", ""));
}

// The contract address, once it is deployed. Until LEDGER_ADDRESS is set the game keeps using plain notes.
export function ledgerAddress(): Hex | null {
  const a = process.env.LEDGER_ADDRESS?.trim();
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Hex) : null;
}

export type LedgerDay = {
  address: Hex;
  commit: Hex | null;
  committedAt: number | null;
  chainRandom: Hex | null;
  randomBlock: number | null;
  revealed: boolean;
};

const ZERO = `0x${"0".repeat(64)}`;

export function publicClient(): PublicClient {
  return createPublicClient({ chain, transport: http() });
}

// What the contract holds for a day, or null when no contract is set up or it cannot be reached.
export async function readLedgerDay(date: string, pub: PublicClient = publicClient()): Promise<LedgerDay | null> {
  const address = ledgerAddress();
  if (!address) return null;
  try {
    const r = (await pub.readContract({ address, abi: LEDGER_ABI, functionName: "getDay", args: [dayNumber(date)] })) as readonly [Hex, bigint, Hex, bigint, boolean];
    return {
      address,
      commit: r[0] === ZERO ? null : r[0],
      committedAt: r[0] === ZERO ? null : Number(r[1]),
      chainRandom: r[2] === ZERO ? null : r[2],
      randomBlock: r[3] === 0n ? null : Number(r[3]),
      revealed: r[4],
    };
  } catch {
    return null;
  }
}

// Posts the day's fingerprint to the contract. Returns the transaction hash, or null when no contract is set up.
export async function commitToLedger(date: string, wallet: WalletClient, pub: PublicClient = publicClient()): Promise<Hex | null> {
  const address = ledgerAddress();
  if (!address || !wallet.account) return null;
  const hash = await wallet.writeContract({ address, abi: LEDGER_ABI, functionName: "commit", args: [dayNumber(date), dailyCommit(date)], account: wallet.account, chain });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The ledger commit failed: ${hash}`);
  return hash;
}

// Reveals a finished day's salt to the contract, which checks it against the fingerprint. Only call for days that are over.
export async function revealToLedger(date: string, wallet: WalletClient, pub: PublicClient = publicClient()): Promise<Hex | null> {
  const address = ledgerAddress();
  if (!address || !wallet.account) return null;
  const hash = await wallet.writeContract({ address, abi: LEDGER_ABI, functionName: "reveal", args: [dayNumber(date), getDailySalt(date)], account: wallet.account, chain });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The ledger reveal failed: ${hash}`);
  return hash;
}

// What a /verify check should compare against the day's fingerprint. A plain note carries the fingerprint as its
// data. A call to the ledger carries it as the second argument of commit(day, fingerprint), so read it from there.
export function fingerprintOfTx(input: string, to?: string | null): string {
  const address = ledgerAddress();
  if (!address || !to || to.toLowerCase() !== address.toLowerCase()) return input;
  try {
    const call = decodeFunctionData({ abi: LEDGER_ABI, data: input as Hex });
    return call.functionName === "commit" ? (call.args as readonly [number, Hex])[1] : input;
  } catch {
    return input;
  }
}
