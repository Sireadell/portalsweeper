// Creates the Portal collection on Portaldot's native NFT pallet (pallet-nfts), owned by the issuer key.
// Only the issuer can mint (MintType Issuer), and at most 500 Portals can ever exist.
// Look first (sends nothing):  node scripts/create-collection.mjs
// Really create:               node scripts/create-collection.mjs --yes
// The issuer key comes from env ISSUER_MNEMONIC or .env.local (made by scripts/new-issuer.ts). It is never printed.
// On success it prints the new collection id; set it as PORTAL_COLLECTION_ID and NEXT_PUBLIC_PORTAL_COLLECTION_ID.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const WS = "wss://test-node-v3.portaldot.dev";
const yes = process.argv.includes("--yes");
const mnemonic = process.env.ISSUER_MNEMONIC;
if (!mnemonic) {
  console.error("ISSUER_MNEMONIC is not set. Run scripts/new-issuer.ts first.");
  process.exit(1);
}

await cryptoWaitReady();
const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
const decimals = api.registry.chainDecimals[0] ?? 18;
const fmt = (v) => (Number(v.toString()) / 10 ** decimals).toFixed(4);

const config = {
  settings: 0, // every collection setting left enabled (transferable items, editable metadata)
  maxSupply: 500,
  mintSettings: { mintType: { Issuer: null }, price: null, startBlock: null, endBlock: null, defaultItemSettings: 0 },
};

const tx = api.tx.nfts.create(issuer.address, config);
const balance = (await api.query.system.account(issuer.address)).data.free;
const deposit = api.consts.nfts.collectionDeposit;
let fee = "unknown";
try {
  fee = fmt((await tx.paymentInfo(issuer)).partialFee);
} catch {
  /* fee estimate needs a funded account on some nodes */
}
console.log(`Issuer ${issuer.address} holds ${fmt(balance)} tPOT.`);
console.log(`Creating the collection locks a deposit of ${fmt(deposit)} tPOT and costs a fee of about ${fee} tPOT.`);

if (!yes) {
  console.log("Dry run: nothing was sent. Add --yes to really create the collection.");
  await api.disconnect();
  process.exit(0);
}
if (BigInt(balance.toString()) < BigInt(deposit.toString())) {
  console.error("The issuer wallet does not hold enough tPOT for the deposit. Nothing was sent.");
  await api.disconnect();
  process.exit(1);
}

const id = await new Promise((resolve, reject) => {
  tx.signAndSend(issuer, ({ status, events, dispatchError }) => {
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
  }).catch(reject);
});

console.log(`Portal collection id: ${id}  (issuer ${issuer.address})`);
await api.disconnect();
process.exit(0);
