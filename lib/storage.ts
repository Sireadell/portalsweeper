// TransactionStorage: keep a winner's move log on chain for the chain's retention window (about 7 days).
// TESTED 2026-11-05: it must be a DIRECT native transaction signed by a Portaldot (sr25519) key. Sent through a 0x wallet
// (the runtime pallets address) the node pool refuses it ("temporarily banned"). The length fee is about 0.1 tPOT per KB
// plus a tiny storage fee, so the sender needs a little tPOT. See scripts/storage-direct-test.ts.
// The chain keeps the bytes only for the retention period, so the permanent proof is the hash we also post (lib/winProof.ts).
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { stringToHex } from "@polkadot/util";

export const STORAGE_MAX_BYTES = 8 * 1024 * 1024;
export const STORAGE_DAYS = 7; // 100,800 blocks of 6 seconds

export function replayBytes(log: unknown): string {
  const text = JSON.stringify(log);
  if (!text || text === "null") throw new Error("Nothing to store.");
  if (new TextEncoder().encode(text).length > STORAGE_MAX_BYTES) throw new Error("That log is too large to store.");
  return text;
}

export const storeCall = (api: ApiPromise, log: unknown): SubmittableExtrinsic<"promise"> => api.tx.transactionStorage.store(stringToHex(replayBytes(log)));

// The chain's own fee: a fixed entry fee plus a fee per byte (raw units, 14 decimals).
export async function storeFee(api: ApiPromise, bytes: number): Promise<bigint> {
  const [entry, per] = await Promise.all([api.query.transactionStorage.entryFee(), api.query.transactionStorage.byteFee()]);
  return BigInt(entry.toString()) + BigInt(per.toString()) * BigInt(bytes);
}

// Sends the log directly, signed by a Portaldot key. Resolves with the block hash once it is included.
export function storeDirect(api: ApiPromise, signer: import("@polkadot/keyring/types").KeyringPair, log: unknown): Promise<{ block: string; txHash: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Storing the log timed out.")), 45_000);
    storeCall(api, log)
      .signAndSend(signer, ({ status, dispatchError, txHash }) => {
        if (dispatchError) {
          clearTimeout(timer);
          reject(new Error(dispatchError.toString()));
        } else if (status.isInBlock) {
          clearTimeout(timer);
          resolve({ block: status.asInBlock.toHex(), txHash: txHash.toHex() });
        }
      })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}
