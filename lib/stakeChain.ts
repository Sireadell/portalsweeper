// The real chain side of stakes: Portaldot V3 EVM. The escrow wallet key is env ESCROW_PRIVATE_KEY (server only).
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot } from "./portaldot";
import type { StakeChain } from "./stakes";

function account() {
  const key = process.env.ESCROW_PRIVATE_KEY;
  if (!key) throw new Error("ESCROW_PRIVATE_KEY is not set.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

export function portaldotStakeChain(): StakeChain {
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  return {
    escrowAddress: () => account().address,
    async getTransfer(txHash) {
      try {
        const tx = await pub.getTransaction({ hash: txHash as Hex });
        const rc = await pub.getTransactionReceipt({ hash: txHash as Hex });
        return { from: tx.from, to: tx.to ?? "", valueWei: tx.value, ok: rc.status === "success" };
      } catch {
        return null;
      }
    },
    async send(to, valueWei) {
      const wallet = createWalletClient({ account: account(), chain: portaldot, transport: http() });
      const hash = await wallet.sendTransaction({ to: to as Hex, value: valueWei });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Payout transaction failed on chain.");
      return { txHash: hash, block: Number(rc.blockNumber) };
    },
  };
}
