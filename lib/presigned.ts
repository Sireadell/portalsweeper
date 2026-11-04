// Pre-signed mint (Nfts.mintPreSigned): the issuer signs a ticket off chain for the winner, and the winner's own
// wallet submits it (as a native call sent through the runtime pallets address) and pays the mint.
// The chain checks the signature, that the signer is the collection's Issuer, the deadline and that only the named account may use it.
import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import type { KeyringPair } from "@polkadot/keyring/types";
import { u8aToHex } from "@polkadot/util";
import { mappedAccount } from "./native";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY } from "./types";

export type TicketInput = { portal: number; winner: string; deadlineBlock: number; collection?: number; attributes?: [string, string][]; metadata?: string };
export type Ticket = { mintData: Record<string, unknown>; signature: { Sr25519: string }; signer: string; winnerAccount: string };

// Signs the ticket with the issuer key. Nothing goes to the chain here.
export function signTicket(api: ApiPromise, issuer: KeyringPair, t: TicketInput): Ticket {
  if (!Number.isInteger(t.portal) || t.portal < 1 || t.portal > PORTAL_SUPPLY) throw new Error(`Portal must be 1 to ${PORTAL_SUPPLY}.`);
  if (!Number.isInteger(t.deadlineBlock) || t.deadlineBlock < 1) throw new Error("deadlineBlock must be a block number.");
  const collection = t.collection ?? PORTAL_COLLECTION_ID;
  if (!Number.isInteger(collection) || collection < 0) throw new Error("The Portal collection is not set.");
  const winnerAccount = mappedAccount(t.winner);
  const mintData = {
    collection,
    item: t.portal,
    attributes: t.attributes ?? [],
    metadata: t.metadata ?? "",
    onlyAccount: winnerAccount,
    deadline: t.deadlineBlock,
    mintPrice: null,
  };
  // The runtime checks the signature over the SCALE encoding of exactly this data.
  const bytes = api.createType("PalletNftsPreSignedMint", mintData).toU8a();
  return { mintData, signature: { Sr25519: u8aToHex(issuer.sign(bytes)) }, signer: issuer.address, winnerAccount };
}

// The call the winner's wallet sends.
export function mintPreSignedCall(api: ApiPromise, t: Ticket): SubmittableExtrinsic<"promise"> {
  return api.tx.nfts.mintPreSigned(t.mintData, t.signature, t.signer);
}
