// The two chain actions of the SHARD economy, each ONE transaction (Utility.batchAll, all or nothing):
//   award:  [mint the Portal + traits, only on the founding day]  SHARD to each of the top 3  one note per winner
//   redeem: take 100 SHARD from the player, burn it, mint the chosen Portal to the player, write its traits, note
import type { PortalAttribute } from "./portalAttributes";

export const PORTAL_PRICE_SHARD = 100n;

export type ShardBatchApi = {
  tx: {
    nfts: {
      mint(c: number, id: number, to: string, w: null): unknown;
      setAttribute(c: number, id: number, ns: { CollectionOwner: null }, key: string, value: string): unknown;
    };
    assets: {
      mint(id: number, to: string, amount: bigint): unknown;
      forceTransfer(id: number, source: string, dest: string, amount: bigint): unknown;
      burn(id: number, who: string, amount: bigint): unknown;
    };
    system: { remarkWithEvent(remark: string): unknown };
    utility: { batchAll(calls: unknown[]): unknown };
  };
};

export type PortalMint = { collection: number; id: number; recipient: string; attributes: PortalAttribute[] };
export type ShardPayout = { account: string; amount: bigint; note: string };

const checkPortal = (id: number) => {
  if (!Number.isInteger(id) || id < 1 || id > 500) throw new Error("Portal must be 1 to 500.");
};

function mintCalls(api: ShardBatchApi, p: PortalMint): unknown[] {
  checkPortal(p.id);
  const calls: unknown[] = [api.tx.nfts.mint(p.collection, p.id, p.recipient, null)];
  for (const a of p.attributes) calls.push(api.tx.nfts.setAttribute(p.collection, p.id, { CollectionOwner: null }, a.key, a.value));
  return calls;
}

export function awardCalls(api: ShardBatchApi, o: { assetId: number; payouts: ShardPayout[]; portal?: PortalMint | null; portalNote?: string }): unknown[] {
  if (o.payouts.length === 0) throw new Error("Nothing to pay.");
  const calls: unknown[] = o.portal ? mintCalls(api, o.portal) : [];
  for (const p of o.payouts) {
    if (p.amount <= 0n) throw new Error("A payout must be above zero.");
    calls.push(api.tx.assets.mint(o.assetId, p.account, p.amount));
  }
  for (const p of o.payouts) calls.push(api.tx.system.remarkWithEvent(p.note));
  if (o.portal && o.portalNote) calls.push(api.tx.system.remarkWithEvent(o.portalNote));
  return calls;
}

export function awardBatch(api: ShardBatchApi, o: Parameters<typeof awardCalls>[1]): unknown {
  return api.tx.utility.batchAll(awardCalls(api, o));
}

export function redeemCalls(api: ShardBatchApi, o: { assetId: number; price?: bigint; player: string; issuer: string; portal: PortalMint; note: string }): unknown[] {
  const price = o.price ?? PORTAL_PRICE_SHARD;
  return [
    // The issuer is the token's admin, so it can move the player's 100 SHARD. If the player no longer has 100, this step fails and nothing else happens.
    api.tx.assets.forceTransfer(o.assetId, o.player, o.issuer, price),
    api.tx.assets.burn(o.assetId, o.issuer, price),
    ...mintCalls(api, o.portal),
    api.tx.system.remarkWithEvent(o.note),
  ];
}

export function redeemBatch(api: ShardBatchApi, o: Parameters<typeof redeemCalls>[1]): unknown {
  return api.tx.utility.batchAll(redeemCalls(api, o));
}

// The notes written to the chain. Anyone can read them in the block's events.
export const awardNoteText = (date: string, place: number, fingerprint: string) => `portalsweeper:cotd:${date}:${place}:${fingerprint}`;
export const redeemNoteText = (portal: number, sigHash: string) => `portalsweeper:redeem:${portal}:${sigHash}`;
