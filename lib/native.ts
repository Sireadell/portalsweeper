// Portaldot native side: the Portal NFT collection lives in pallet-nfts, not in a Solidity contract.
// (On the V3 testnet a Solidity contract locks about 0.06 tPOT per byte of code; a native NFT
// costs about 0.1 tPOT to mint.) Server only (imported by API routes): the minting key never reaches the browser.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, encodeAddress, decodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY, PORTALDOT_WS } from "./types";

let apiPromise: Promise<ApiPromise> | null = null;
export function getApi(): Promise<ApiPromise> {
  if (!apiPromise) {
    apiPromise = ApiPromise.create({ provider: new WsProvider(PORTALDOT_WS), noInitWarn: true, throwOnConnect: true }).catch((e) => {
      apiPromise = null;
      throw e;
    });
  }
  return apiPromise;
}

// pallet-revive maps an 0x (H160) wallet to the native account H160 ++ 0xEE x 12, so a Portal minted
// to that account is owned by the player's 0x wallet with no extra setup.
export function mappedAccount(h160: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(h160)) throw new Error("Not an 0x address.");
  return encodeAddress(hexToU8a(h160.toLowerCase() + "ee".repeat(12)), 42);
}

// The reverse: an owner account that came from an 0x wallet gives that wallet back, otherwise null.
export function walletOf(account: string): string | null {
  const hex = u8aToHex(decodeAddress(account));
  return hex.endsWith("ee".repeat(12)) ? hex.slice(0, 42) : null;
}

function collectionId(): number {
  if (!Number.isInteger(PORTAL_COLLECTION_ID) || PORTAL_COLLECTION_ID < 0) throw new Error("PORTAL_COLLECTION_ID is not set.");
  return PORTAL_COLLECTION_ID;
}

// Owner (native account) of each minted Portal. Unminted Portals are left out.
export async function portalOwners(ids: number[]): Promise<Map<number, string>> {
  const api = await getApi();
  const col = collectionId();
  const rows = await api.query.nfts.item.multi(ids.map((id) => [col, id]));
  const out = new Map<number, string>();
  rows.forEach((r, i) => {
    const v = r.toJSON() as { owner?: string } | null;
    if (v?.owner) out.set(ids[i], encodeAddress(v.owner, 42));
  });
  return out;
}

// Portal numbers held by an 0x wallet (through its mapped native account).
export async function portalsOfWallet(h160: string): Promise<number[]> {
  const api = await getApi();
  const keys = await api.query.nfts.account.keys(mappedAccount(h160), collectionId());
  return keys.map((k) => Number(k.args[2].toString())).filter((n) => n >= 1 && n <= PORTAL_SUPPLY).sort((a, b) => a - b);
}

export type MintResult = { txHash: string; block: number; to: string };

// Accepts an 0x wallet or a Portaldot (SS58) account and gives the native account that will own the Portal.
export function recipientAccount(input: string): string {
  const v = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return mappedAccount(v);
  try {
    if (v.startsWith("0x")) throw new Error("hex");
    const raw = decodeAddress(v);
    if (raw.length !== 32) throw new Error("length");
    return encodeAddress(raw, 42);
  } catch {
    throw new Error("Not a valid 0x wallet or Portaldot account address.");
  }
}

const MINT_TIMEOUT_MS = 45_000;

// Mints Portal `id` to an 0x wallet (or SS58 account), signed by the collection's issuer key (env ISSUER_MNEMONIC).
export async function mintPortal(id: number, recipient: string): Promise<MintResult> {
  const mnemonic = process.env.ISSUER_MNEMONIC;
  if (!mnemonic) throw new Error("ISSUER_MNEMONIC is not set.");
  await cryptoWaitReady();
  const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
  const api = await getApi();
  const to = recipientAccount(recipient);
  const tx = api.tx.nfts.mint(collectionId(), id, to, null);
  return new Promise<MintResult>((resolve, reject) => {
    // A dropped transaction never reports back; give up before the server timer is killed so the failure is logged.
    const timer = setTimeout(() => reject(new Error("Mint timed out waiting for a block.")), MINT_TIMEOUT_MS);
    const done = <T,>(f: (v: T) => void) => (v: T) => {
      clearTimeout(timer);
      f(v);
    };
    const ok = done(resolve);
    const fail = done(reject);
    tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
      if (dispatchError) {
        const msg = dispatchError.isModule
          ? (() => {
              const m = api.registry.findMetaError(dispatchError.asModule);
              return `${m.section}.${m.name}`;
            })()
          : dispatchError.toString();
        fail(new Error(`Mint failed: ${msg}`));
        return;
      }
      if (status.isInBlock) {
        api.rpc.chain
          .getHeader(status.asInBlock)
          .then((h) => ok({ txHash: txHash.toHex(), block: h.number.toNumber(), to }))
          .catch(fail);
      }
    }).catch(fail);
  });
}
