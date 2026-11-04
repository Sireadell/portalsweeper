// The real chain side of stakes: Portaldot V3 EVM. The escrow wallet key is env ESCROW_PRIVATE_KEY (server only).
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot } from "./portaldot";
import type { StakeChain } from "./stakes";
import { escrowContractAddress, refundMatch, settleMatch } from "./escrow";

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

// Stakes through the StakeEscrow contract (contracts/StakeEscrow.sol) instead of the plain escrow wallet.
// Players call create and join on the contract with their stake attached, so their transaction goes to the
// contract address and lockStake accepts its hash as before. The payout and the refund are contract calls
// by the referee, keyed by the challenge id, so they are exposed as settle and refundAll.
// send() is not used in this mode because the contract, not the server wallet, holds the money.
export type ContractStakeChain = StakeChain & {
  settle(challengeId: string, winner: string): Promise<{ txHash: string; block?: number }>;
  refundAll(challengeId: string): Promise<{ txHash: string; block?: number }>;
};

export function portaldotContractStakeChain(): ContractStakeChain {
  const base = portaldotStakeChain();
  return {
    ...base,
    escrowAddress() {
      const a = escrowContractAddress();
      if (!a) throw new Error("ESCROW_CONTRACT_ADDRESS is not set.");
      return a;
    },
    async send() {
      throw new Error("The escrow contract pays out with settle or refundAll, not a plain transfer.");
    },
    settle: (challengeId, winner) => settleMatch(challengeId, winner),
    refundAll: (challengeId) => refundMatch(challengeId),
  };
}

// The contract chain when ESCROW_CONTRACT_ADDRESS is set, else the plain wallet chain.
export function stakeChainFromEnv(): StakeChain {
  return escrowContractAddress() ? portaldotContractStakeChain() : portaldotStakeChain();
}
