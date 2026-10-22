// Creates the Portal collection on Portaldot's native NFT pallet (pallet-nfts), owned by the issuer key.
// Only the issuer can mint (MintType Issuer), and at most 500 Portals can ever exist.
// Run once: ISSUER_MNEMONIC="..." node scripts/create-collection.mjs
// Prints the new collection id; set it as PORTAL_COLLECTION_ID and NEXT_PUBLIC_PORTAL_COLLECTION_ID.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";

const WS = "wss://test-node-v3.portaldot.dev";
const mnemonic = process.env.ISSUER_MNEMONIC;
if (!mnemonic) {
  console.error("ISSUER_MNEMONIC is not set.");
  process.exit(1);
}

await cryptoWaitReady();
const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });

const config = {
  settings: 0, // every collection setting left enabled (transferable items, editable metadata)
  maxSupply: 500,
  mintSettings: { mintType: { Issuer: null }, price: null, startBlock: null, endBlock: null, defaultItemSettings: 0 },
};

const id = await new Promise((resolve, reject) => {
  api.tx.nfts
    .create(issuer.address, config)
    .signAndSend(issuer, ({ status, events, dispatchError }) => {
      if (dispatchError) {
        const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
        reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
        return;
      }
      if (status.isInBlock) {
        const created = events.find(({ event }) => api.events.nfts.Created.is(event));
        if (!created) reject(new Error("No Created event."));
        else {
          console.log(`In block ${status.asInBlock.toHex()}`);
          resolve(Number(created.event.data[0].toString()));
        }
      }
    })
    .catch(reject);
});

console.log(`Portal collection id: ${id}  (issuer ${issuer.address})`);
await api.disconnect();
