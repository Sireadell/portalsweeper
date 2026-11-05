// Pays a backing pool out in ONE chain action. The escrow wallet signs a normal Ethereum transaction to the
// "runtime pallets" address (see lib/swap.ts). Its data is a Utility.batchAll of Balances transfers, one per
// winner, plus a note, so every payout lands together or not at all. If that batch is refused the caller can
// fall back to plain transfers one by one with payEach.
import { createPublicClient, createWalletClient, http, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot } from "./portaldot";
import { getApi, mappedAccount } from "./native";
import { PALLETS_ADDRESS } from "./swap";

export type Payment = { to: string; wei: bigint };
export type Sent = { txHash: string; block?: number };

// The chain counts tPOT with 14 decimals natively and 18 in Ethereum units, so 10^4 wei is one native unit.
export const WEI_PER_NATIVE = 10_000n;
export const weiToNative = (wei: bigint): bigint => wei / WEI_PER_NATIVE;

// The note written next to the payout. "refund" in place of a winner wallet when everyone gets their coins back.
export function poolNote(eventId: string, who: string): string {
  if (!/^[0-9a-f]{12}$/.test(eventId)) throw new Error("Event id must be 12 hex characters.");
  if (who !== "refund" && !/^0x[0-9a-f]{40}$/.test(who)) throw new Error("Winner must be a lowercase 0x wallet or the word refund.");
  return `portalsweeper:pool:${eventId}:${who}`;
}

export interface PoolChain {
  escrowAddress(): string;
  getTransfer(txHash: string): Promise<{ from: string; to: string; valueWei: bigint; ok: boolean } | null>;
  payBatch(payments: Payment[], note: string): Promise<Sent>;
  payEach(payments: Payment[]): Promise<Sent[]>;
}

function escrowAccount() {
  const key = process.env.ESCROW_PRIVATE_KEY;
  if (!key) throw new Error("ESCROW_PRIVATE_KEY is not set.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

// The escrow WALLET (not the escrow contract): backers send plain transfers here.
export const escrowWalletAddress = (): string => escrowAccount().address;

// Builds the batch call. Exposed so the test script can show it before anything is sent.
export async function poolBatchData(payments: Payment[], note: string): Promise<Hex> {
  if (!payments.length) throw new Error("Nothing to pay.");
  const api = await getApi();
  const calls: unknown[] = payments.map((p) => {
    const native = weiToNative(p.wei);
    if (native <= 0n) throw new Error("A payment is too small to send.");
    return api.tx.balances.transferKeepAlive(mappedAccount(p.to), native);
  });
  calls.push(api.tx.system.remarkWithEvent(stringToHex(note)));
  return api.tx.utility.batchAll(calls as never).method.toHex() as Hex;
}

export function portaldotPoolChain(): PoolChain {
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  return {
    escrowAddress: escrowWalletAddress,
    async getTransfer(txHash) {
      try {
        const tx = await pub.getTransaction({ hash: txHash as Hex });
        const rc = await pub.getTransactionReceipt({ hash: txHash as Hex });
        return { from: tx.from, to: tx.to ?? "", valueWei: tx.value, ok: rc.status === "success" };
      } catch {
        return null;
      }
    },
    async payBatch(payments, note) {
      const data = await poolBatchData(payments, note);
      const wallet = createWalletClient({ account: escrowAccount(), chain: portaldot, transport: http() });
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data, value: 0n });
      } catch (e) {
        // Nothing was sent, so the caller may safely pay one by one instead.
        throw new Error(`The node refused the payout batch: ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 200)}`);
      }
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (rc.status !== "success") throw new Error("The payout batch was refused: it failed on chain and moved nothing.");
      return { txHash: hash, block: Number(rc.blockNumber) };
    },
    async payEach(payments) {
      const wallet = createWalletClient({ account: escrowAccount(), chain: portaldot, transport: http() });
      const out: Sent[] = [];
      for (const p of payments) {
        const hash = await wallet.sendTransaction({ to: p.to as Hex, value: p.wei });
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (rc.status !== "success") throw new Error("A payout transfer failed on chain.");
        out.push({ txHash: hash, block: Number(rc.blockNumber) });
      }
      return out;
    },
  };
}
