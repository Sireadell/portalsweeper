// The real chain side of stakes: Portaldot V3 EVM. The escrow wallet key is env ESCROW_PRIVATE_KEY (server only).
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot } from "./portaldot";
import type { StakeChain } from "./stakes";
import { escrowContractAddress, refundMatch, settleMatch } from "./escrow";
import { getApi, mappedAccount, portalOwners } from "./native";
import { PALLETS_ADDRESS, ethCallData } from "./swap";
import { lockCall, payoutBatch } from "./portalStake";

function account() {
  const key = process.env.ESCROW_PRIVATE_KEY;
  if (!key) throw new Error("ESCROW_PRIVATE_KEY is not set.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

export function portaldotStakeChain(): StakeChain {
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  return {
    ...portalStakeMethods(),
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

// Portal stakes: the escrow WALLET (never the contract) holds the Portals. A player moves a Portal to the wallet's
// mapped native account with their own wallet (Nfts.transfer sent to the runtime pallets address). Proven on chain
// by scripts/test-portal-stake.ts. Trusted custody: our server holds the Portals until the race ends.
export function portalStakeMethods(): Required<Pick<StakeChain, "portalEscrowAddress" | "verifyPortalLock" | "portalHeld" | "payoutPortals">> {
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const escrowNative = () => mappedAccount(account().address);
  const held = async (portal: number) => (await portalOwners([portal])).get(portal) === escrowNative();
  return {
    portalEscrowAddress: () => account().address,
    portalHeld: held,
    async verifyPortalLock(wallet, portal, txHash) {
      let tx;
      let rc;
      try {
        tx = await pub.getTransaction({ hash: txHash as Hex });
        rc = await pub.getTransactionReceipt({ hash: txHash as Hex });
      } catch {
        return { ok: false, error: "Transaction not found yet. Wait a few seconds and try again." };
      }
      if (rc.status !== "success") return { ok: false, error: "That transaction failed on chain." };
      if (tx.from.toLowerCase() !== wallet.toLowerCase()) return { ok: false, error: "That transfer came from a different wallet." };
      if ((tx.to ?? "").toLowerCase() !== PALLETS_ADDRESS) return { ok: false, error: "That transaction is not a Portal transfer." };
      const expected = ethCallData(lockCall(await getApi(), portal, escrowNative()));
      if (tx.input.toLowerCase() !== expected.toLowerCase()) return { ok: false, error: `That transaction does not move Portal #${portal} to the escrow wallet.` };
      if (!(await held(portal))) return { ok: false, error: `The escrow wallet does not hold Portal #${portal} yet.` };
      return { ok: true };
    },
    // One batch moves every Portal and writes the note. All or nothing; the owners are read back afterwards.
    async payoutPortals(note, moves) {
      const api = await getApi();
      const call = payoutBatch(api, moves.map((m) => ({ portal: m.portal, to: mappedAccount(m.to) })), note);
      const wallet = createWalletClient({ account: account(), chain: portaldot, transport: http() });
      const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(call), value: 0n });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (rc.status !== "success") throw new Error("Portal payout failed on chain.");
      const owners = await portalOwners(moves.map((m) => m.portal));
      for (const m of moves) if (owners.get(m.portal) !== mappedAccount(m.to)) throw new Error(`Portal #${m.portal} did not reach its new owner.`);
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
