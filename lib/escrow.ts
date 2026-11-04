// The stake escrow contract on Portaldot V3 (EVM side): ids, reading a match, and the referee calls.
// The contract is contracts/StakeEscrow.sol. Players call create and join themselves with their stake
// attached; the server (the referee wallet, env ESCROW_PRIVATE_KEY) only calls settle or refund.
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../contracts/StakeEscrow.json";
import { portaldot } from "./portaldot";

export const ESCROW_ABI = artifact.abi;

export const MATCH_STATUS = ["none", "open", "locked", "settled", "refunded"] as const;
export type MatchStatus = (typeof MATCH_STATUS)[number];
export type EscrowMatch = { creator: string; opponent: string; amountWei: bigint; deadline: number; status: MatchStatus };

// The contract's match id for a challenge: keccak256 of the challenge id text.
export const matchId = (challengeId: string): Hex => keccak256(toHex(challengeId));

// The deployed contract, once ESCROW_CONTRACT_ADDRESS is set. Until then stakes use the plain wallet.
export function escrowContractAddress(): Hex | null {
  const a = process.env.ESCROW_CONTRACT_ADDRESS?.trim();
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Hex) : null;
}

function need(): Hex {
  const a = escrowContractAddress();
  if (!a) throw new Error("ESCROW_CONTRACT_ADDRESS is not set.");
  return a;
}

export function decodeMatch(r: readonly [string, string, bigint, bigint, number | bigint]): EscrowMatch {
  return { creator: r[0], opponent: r[1], amountWei: r[2], deadline: Number(r[3]), status: MATCH_STATUS[Number(r[4])] ?? "none" };
}

export async function readMatch(challengeId: string): Promise<EscrowMatch> {
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const r = (await pub.readContract({ address: need(), abi: ESCROW_ABI, functionName: "getMatch", args: [matchId(challengeId)] })) as readonly [string, string, bigint, bigint, number];
  return decodeMatch(r);
}

function referee() {
  const key = process.env.ESCROW_PRIVATE_KEY;
  if (!key) throw new Error("ESCROW_PRIVATE_KEY is not set.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

async function refCall(fn: "settle" | "refund", args: unknown[]) {
  const account = referee();
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const wallet = createWalletClient({ account, chain: portaldot, transport: http() });
  const hash = await wallet.writeContract({ address: need(), abi: ESCROW_ABI, functionName: fn, args, account, chain: portaldot } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`Escrow ${fn} failed on chain.`);
  return { txHash: hash as string, block: Number(rc.blockNumber) };
}

// The referee names the winner: the contract pays the whole pot to that player.
export const settleMatch = (challengeId: string, winner: string) => refCall("settle", [matchId(challengeId), winner as Hex]);
// The referee gives every stake back (a draw or a cancelled match).
export const refundMatch = (challengeId: string) => refCall("refund", [matchId(challengeId)]);
