"use client";
import { createWalletClient, custom, parseEther, type EIP1193Provider, type Hex } from "viem";
import { portaldot } from "@/lib/portaldot";

// Sends the stake from the player's own wallet to the escrow wallet, then tells the server the
// transaction hash so it can check it on chain. Testnet tPOT only.
export async function sendAndLockStake(opts: { challengeId: string; wallet: string; escrow: string; stakeTpot: string }): Promise<unknown> {
  const eth = window.ethereum as EIP1193Provider | undefined;
  if (!eth) throw new Error("No wallet found in this browser.");
  const client = createWalletClient({ account: opts.wallet as Hex, chain: portaldot, transport: custom(eth) });
  const txHash = await client.sendTransaction({ to: opts.escrow as Hex, value: parseEther(opts.stakeTpot) });
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
