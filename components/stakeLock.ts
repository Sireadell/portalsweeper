"use client";
import { createPublicClient, createWalletClient, custom, http, keccak256, parseEther, toHex, type EIP1193Provider, type Hex } from "viem";
import { portaldot } from "@/lib/portaldot";

const ESCROW_READ_ABI = [{ type: "function", name: "getMatch", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ type: "address" }, { type: "address" }, { type: "uint128" }, { type: "uint64" }, { type: "uint8" }] }] as const;
const ESCROW_WRITE_ABI = [
  { type: "function", name: "create", stateMutability: "payable", inputs: [{ name: "id", type: "bytes32" }, { name: "deadline", type: "uint64" }], outputs: [] },
  { type: "function", name: "join", stateMutability: "payable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
] as const;

// Sends the stake from the player's own wallet to the escrow wallet, then tells the server the
// transaction hash so it can check it on chain. Testnet tPOT only.
export async function sendAndLockStake(opts: { challengeId: string; wallet: string; escrow: string; stakeTpot: string }): Promise<unknown> {
  const eth = window.ethereum as EIP1193Provider | undefined;
  if (!eth) throw new Error("No wallet found in this browser.");
  const client = createWalletClient({ account: opts.wallet as Hex, chain: portaldot, transport: custom(eth) });
  const value = parseEther(opts.stakeTpot);
  // The escrow contract has no plain-transfer entry: the first player calls create, the second calls join.
  // A plain wallet escrow (older setup) still takes a normal transfer. A wallet address has no code.
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const isContract = ((await pub.getCode({ address: opts.escrow as Hex })) ?? "0x") !== "0x";
  let txHash: Hex;
  if (!isContract) {
    txHash = await client.sendTransaction({ to: opts.escrow as Hex, value });
  } else {
    const id = keccak256(toHex(opts.challengeId));
    const status = Number(((await pub.readContract({ address: opts.escrow as Hex, abi: ESCROW_READ_ABI, functionName: "getMatch", args: [id] })) as readonly unknown[])[4]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
    txHash = status === 0
      ? await client.writeContract({ address: opts.escrow as Hex, abi: ESCROW_WRITE_ABI, functionName: "create", args: [id, deadline], value })
      : await client.writeContract({ address: opts.escrow as Hex, abi: ESCROW_WRITE_ABI, functionName: "join", args: [id], value });
    await pub.waitForTransactionReceipt({ hash: txHash });
  }
  // The server may need a moment to see the transfer, so try a few times before giving up.
  let last = "Could not lock the stake.";
  for (let i = 0; i < 8; i++) {
    const r = await fetch("/api/stakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "lock", challengeId: opts.challengeId, wallet: opts.wallet, txHash }),
    });
    const j = await r.json();
    if (r.ok) return j;
    last = j.error ?? last;
    if (!/not found yet/i.test(last)) break;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`${last} Your transfer ${txHash} was sent. Do not send it again; ask the site owner to check it.`);
}
