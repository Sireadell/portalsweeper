// Server-only chain side of the SHARD economy: reads (balance, supply, which Portals exist) and the issuer-signed batches.
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { createPublicClient, http, parseAbiItem, type Hex } from "viem";
import { getApi, mappedAccount, portalOwners, recipientAccount } from "./native";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY } from "./types";
import { shardAssetId, assetErc20Address } from "./shardToken";
import { portaldot } from "./portaldot";
import { attributeDeposit, portalAttributes, type PortalRecord } from "./portalAttributes";
import { awardBatch, redeemBatch, awardNoteText, type ShardBatchApi } from "./shardBatch";
import { dayNumber, ledgerAddress } from "./ledger";
import type { AwardRow } from "./shardAward";
import portals from "../data/portals.json";

const SEND_TIMEOUT_MS = 45_000;
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "https://portalsweeper.vercel.app";

export const shardErc20 = () => assetErc20Address(shardAssetId());

async function issuerPair() {
  const mnemonic = process.env.ISSUER_MNEMONIC;
  if (!mnemonic) throw new Error("ISSUER_MNEMONIC is not set.");
  await cryptoWaitReady();
  return new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
}

export async function issuerAddress(): Promise<string> {
  return (await issuerPair()).address;
}

export async function shardBalanceOf(wallet: string): Promise<number> {
  const api = await getApi();
  const row = (await api.query.assets.account(shardAssetId(), recipientAccount(wallet))).toJSON() as { balance?: number | string } | null;
  return Number(row?.balance ?? 0);
}

export async function shardSupply(): Promise<number> {
  const api = await getApi();
  const a = (await api.query.assets.asset(shardAssetId())).toJSON() as { supply?: number | string } | null;
  return Number(a?.supply ?? 0);
}

// Every Portal number that is already minted (these cannot be picked).
export async function mintedPortalIds(): Promise<number[]> {
  const api = await getApi();
  const keys = await api.query.nfts.item.keys(PORTAL_COLLECTION_ID);
  return keys.map((k) => Number(k.args[1].toString())).filter((n) => n >= 1 && n <= PORTAL_SUPPLY).sort((a, b) => a - b);
}

export async function portalOwnerOf(id: number): Promise<string | null> {
  return (await portalOwners([id])).get(id) ?? null;
}

const attributesFor = (id: number) => {
  const p = (portals as PortalRecord[]).find((x) => x.id === id);
  if (!p) throw new Error(`Portal #${id} is not in the Portal list.`);
  return portalAttributes(p, site());
};

// Signs and sends one transaction as the issuer and waits for its block.
async function sendIssuerTx(tx: ReturnType<Awaited<ReturnType<typeof getApi>>["tx"]["utility"]["batchAll"]>): Promise<{ txHash: string; block: number }> {
  const api = await getApi();
  const issuer = await issuerPair();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Send timed out waiting for a block.")), SEND_TIMEOUT_MS);
    const done = <T,>(f: (v: T) => void) => (v: T) => {
      clearTimeout(timer);
      f(v);
    };
    const ok = done(resolve);
    const fail = done(reject);
    tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
      if (dispatchError) {
        const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
        fail(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
      } else if (status.isInBlock) {
        api.rpc.chain.getHeader(status.asInBlock).then((h) => ok({ txHash: txHash.toHex(), block: h.number.toNumber() })).catch(fail);
      }
    }).catch(fail);
  });
}

// One transaction for the whole day: SHARD to each winner, a note per winner, and on the founding day the Portal.
export async function sendAward(o: { date: string; rows: AwardRow[]; portal: number | null }) {
  const api = await getApi();
  const portal = o.portal === null ? null : { collection: PORTAL_COLLECTION_ID, id: o.portal, recipient: recipientAccount(o.rows[0].wallet), attributes: attributesFor(o.portal) };
  const tx = awardBatch(api as unknown as ShardBatchApi, {
    assetId: shardAssetId(),
    payouts: o.rows.map((r) => ({ account: recipientAccount(r.wallet), amount: BigInt(r.amount), note: awardNoteText(o.date, r.place, r.fingerprint) })),
    portal,
    portalNote: portal ? `portalsweeper:founding:${o.date}:portal=${o.portal}` : undefined,
  });
  return sendIssuerTx(tx as never);
}

// One transaction for a redeem. The issuer's deposit for the Portal and its traits is checked first.
export async function sendRedeem(o: { wallet: string; portal: number; note: string }) {
  const api = await getApi();
  const issuer = await issuerPair();
  const attrs = attributesFor(o.portal);
  const need = BigInt(api.consts.nfts.itemDeposit.toString()) + attributeDeposit(attrs, BigInt(api.consts.nfts.attributeDepositBase.toString()), BigInt(api.consts.nfts.depositPerByte.toString()));
  const free = BigInt(((await api.query.system.account(issuer.address)).toJSON() as { data: { free: number | string } }).data.free.toString());
  if (free < need * 2n) throw new Error("The issuer is low on test coins, so no more Portals can be redeemed right now.");
  const tx = redeemBatch(api as unknown as ShardBatchApi, {
    assetId: shardAssetId(),
    player: mappedAccount(o.wallet),
    issuer: issuer.address,
    portal: { collection: PORTAL_COLLECTION_ID, id: o.portal, recipient: mappedAccount(o.wallet), attributes: attrs },
    note: o.note,
  });
  return sendIssuerTx(tx as never);
}

// The wallet the ledger contract holds as a day's winner, read from its Winner event. Null when none was recorded.
export async function ledgerWinnerOf(date: string): Promise<string | null> {
  const address = ledgerAddress();
  if (!address) return null;
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const head = await pub.getBlockNumber();
  const logs = await pub.getLogs({
    address,
    event: parseAbiItem("event Winner(uint32 indexed day, uint16 portal, address winner, bytes32 moveLogHash)"),
    args: { day: dayNumber(date) },
    fromBlock: head > 400_000n ? head - 400_000n : 0n,
    toBlock: head,
  });
  return logs.length ? (logs[logs.length - 1].args.winner as Hex).toLowerCase() : null;
}
