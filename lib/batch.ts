// One transaction that settles a day's award on Portaldot V3, using the Utility module's batchAll:
//   1. mint the Portal (Nfts)            2. write its name, picture link and traits (Nfts attributes)
//   3. pay the SHARD reward (Assets)     4. write a ledger note (System remark, shows as an event)
// batchAll is all or nothing: if any step fails, none of it lands.
import { type PortalAttribute } from "./portalAttributes";

export type AwardBatch = {
  collection: number;
  portal: number;
  recipient: string; // native account that will own the Portal and receive the SHARD
  attributes: PortalAttribute[];
  shardAssetId: number;
  shardAmount: bigint; // 0 leaves the SHARD step out
  note: string;
};

// The note written to the chain with the award. Short, plain text, readable in the block's events.
export function awardNote(date: string, portal: number, winner: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must look like 2026-11-05.");
  return `portalsweeper award ${date} portal=${portal} winner=${winner}`;
}

// Minimal shape of the polkadot api this builder needs, so tests can run without a chain.
export type BatchApi = {
  tx: {
    nfts: {
      mint(c: number, id: number, to: string, w: null): unknown;
      setAttribute(c: number, id: number, ns: { CollectionOwner: null }, key: string, value: string): unknown;
    };
    assets: { mint(id: number, to: string, amount: bigint): unknown };
    system: { remarkWithEvent(remark: string): unknown };
    utility: { batchAll(calls: unknown[]): unknown };
  };
};

export function awardCalls(api: BatchApi, b: AwardBatch): unknown[] {
  if (!Number.isInteger(b.portal) || b.portal < 1 || b.portal > 500) throw new Error("Portal must be 1 to 500.");
  const calls: unknown[] = [api.tx.nfts.mint(b.collection, b.portal, b.recipient, null)];
  for (const a of b.attributes) calls.push(api.tx.nfts.setAttribute(b.collection, b.portal, { CollectionOwner: null }, a.key, a.value));
  if (b.shardAmount > 0n) calls.push(api.tx.assets.mint(b.shardAssetId, b.recipient, b.shardAmount));
  calls.push(api.tx.system.remarkWithEvent(b.note));
  return calls;
}

export function awardBatchTx(api: BatchApi, b: AwardBatch): unknown {
  return api.tx.utility.batchAll(awardCalls(api, b));
}
