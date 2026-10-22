// Portaldot native side: the Pot NFT collection lives in pallet-nfts, not in a Solidity contract.
// (On the V3 testnet a Solidity contract locks about 0.06 tPOT per byte of code; a native NFT
// costs about 0.1 tPOT to mint.) Server only (imported by API routes): the minting key never reaches the browser.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, encodeAddress, decodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { POT_COLLECTION_ID, POT_SUPPLY, PORTALDOT_WS } from "./types";

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

// pallet-revive maps an 0x (H160) wallet to the native account H160 ++ 0xEE x 12, so a Pot minted
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
  if (!Number.isInteger(POT_COLLECTION_ID) || POT_COLLECTION_ID < 0) throw new Error("POT_COLLECTION_ID is not set.");
  return POT_COLLECTION_ID;
}

// Owner (native account) of each minted Pot. Unminted Pots are left out.
export async function potOwners(ids: number[]): Promise<Map<number, string>> {
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

// Pot numbers held by an 0x wallet (through its mapped native account).
export async function potsOfWallet(h160: string): Promise<number[]> {
  const api = await getApi();
  const keys = await api.query.nfts.account.keys(mappedAccount(h160), collectionId());
  return keys.map((k) => Number(k.args[2].toString())).filter((n) => n >= 1 && n <= POT_SUPPLY).sort((a, b) => a - b);
}

export type MintResult = { txHash: string; block: number; to: string };

// Mints Pot `id` to the native account of `h160`, signed by the collection's issuer key (env ISSUER_MNEMONIC).
export async function mintPot(id: number, h160: string): Promise<MintResult> {
  const mnemonic = process.env.ISSUER_MNEMONIC;
  if (!mnemonic) throw new Error("ISSUER_MNEMONIC is not set.");
  await cryptoWaitReady();
  const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
  const api = await getApi();
  const to = mappedAccount(h160);
  const tx = api.tx.nfts.mint(collectionId(), id, to, null);
  return new Promise<MintResult>((resolve, reject) => {
    tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
      if (dispatchError) {
        const msg = dispatchError.isModule
          ? (() => {
              const m = api.registry.findMetaError(dispatchError.asModule);
              return `${m.section}.${m.name}`;
            })()
          : dispatchError.toString();
        reject(new Error(`Mint failed: ${msg}`));
        return;
      }
      if (status.isInBlock) {
        api.rpc.chain
          .getHeader(status.asInBlock)
          .then((h) => resolve({ txHash: txHash.toHex(), block: h.number.toNumber(), to }))
          .catch(reject);
      }
    }).catch(reject);
  });
}
