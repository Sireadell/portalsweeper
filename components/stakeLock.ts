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
    // The chain charges a storage deposit with every contract call: about 8 tPOT to open a match, 4 to join.
    // It checks the wallet can cover it before it accepts the bet, so say so plainly instead of a vague error.
    const need = parseEther(status === 0 ? "9" : "5") + value;
    const have = await pub.getBalance({ address: opts.wallet as Hex });
    if (have < need) throw new Error(`Your wallet needs about ${status === 0 ? 9 : 5} tPOT free to ${status === 0 ? "open" : "join"} a staked match (the chain's storage fee, mostly kept by the network). You have ${Number(have / 10n ** 15n) / 1000} tPOT.`);
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

// Portal stake: the player moves one Portal to the escrow wallet with their own wallet. The server builds the bytes
// of the transfer (the browser does not carry the chain library), the wallet signs and sends them, then the server
// looks at the chain before it counts the lock.
export async function sendAndLockPortal(opts: { challengeId: string; wallet: string; portal: number }): Promise<unknown> {
  const eth = window.ethereum as EIP1193Provider | undefined;
  if (!eth) throw new Error("No wallet found in this browser.");
  const call = await fetch("/api/stakes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "portalcall", challengeId: opts.challengeId, portal: opts.portal }),
  });
  const cj = await call.json();
  if (!call.ok) throw new Error(cj.error ?? "Could not prepare the Portal transfer.");
  const client = createWalletClient({ account: opts.wallet as Hex, chain: portaldot, transport: custom(eth) });
  const txHash = await client.sendTransaction({ to: cj.to as Hex, data: cj.data as Hex, value: 0n });
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  await pub.waitForTransactionReceipt({ hash: txHash });
  let last = "Could not lock the Portal.";
  for (let i = 0; i < 8; i++) {
    const r = await fetch("/api/stakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "lock", challengeId: opts.challengeId, wallet: opts.wallet, portal: opts.portal, txHash }),
    });
    const j = await r.json();
    if (r.ok) return j;
    last = j.error ?? last;
    if (!/not found yet|does not hold/i.test(last)) break;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`${last} Your Portal transfer ${txHash} was sent. Do not send it again; ask the site owner to check it.`);
}
