// Portal for Portal swaps with Portaldot's built-in Nfts module (createSwap, claimSwap), no contract needed.
// A player signs these from their normal 0x wallet: the native call is sent as an Ethereum-signed transaction to the
// "runtime pallets" address (revive.ethSubstrateCall, proven in scripts/test-ethsubstrate.ts).
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY } from "./types";

// The address that stands for the runtime's pallets, read from the chain.
export const PALLETS_ADDRESS = "0x6d6f646c70792f70616464720000000000000000" as const;
export const SWAP_DEFAULT_BLOCKS = 100_800; // 7 days at 6 seconds a block

type Call = SubmittableExtrinsic<"promise">;

// The bytes to put in the data field of the Ethereum transaction that goes to PALLETS_ADDRESS.
export const ethCallData = (call: Call): `0x${string}` => call.method.toHex() as `0x${string}`;

function portal(id: number, label: string) {
  if (!Number.isInteger(id) || id < 1 || id > PORTAL_SUPPLY) throw new Error(`${label} must be a Portal number from 1 to ${PORTAL_SUPPLY}.`);
}

export type SwapOffer = { give: number; want: number; blocks?: number; collection?: number };

// "I give Portal `give` and want Portal `want`", open for `blocks` blocks (default 7 days).
export function createSwapCall(api: ApiPromise, o: SwapOffer): Call {
  portal(o.give, "give");
  portal(o.want, "want");
  if (o.give === o.want) throw new Error("A Portal cannot be swapped for itself.");
  const col = o.collection ?? PORTAL_COLLECTION_ID;
  if (!Number.isInteger(col) || col < 0) throw new Error("The Portal collection is not set.");
  const blocks = o.blocks ?? SWAP_DEFAULT_BLOCKS;
  const max = Number(api.consts.nfts.maxDeadlineDuration.toString());
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > max) throw new Error(`A swap can stay open for 1 to ${max} blocks.`);
  return api.tx.nfts.createSwap(col, o.give, col, o.want, null, blocks);
}

// The other side takes the offer: they send `send` (the Portal that was asked for) and receive `receive`.
export function claimSwapCall(api: ApiPromise, o: { send: number; receive: number; collection?: number }): Call {
  portal(o.send, "send");
  portal(o.receive, "receive");
  const col = o.collection ?? PORTAL_COLLECTION_ID;
  if (!Number.isInteger(col) || col < 0) throw new Error("The Portal collection is not set.");
  return api.tx.nfts.claimSwap(col, o.send, col, o.receive, null);
}

export const cancelSwapCall = (api: ApiPromise, give: number, collection = PORTAL_COLLECTION_ID): Call => {
  portal(give, "give");
  return api.tx.nfts.cancelSwap(collection, give);
};
