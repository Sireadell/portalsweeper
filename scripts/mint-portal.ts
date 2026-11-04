// Mints one Portal to a winner by hand, signed by the collection issuer, and writes its name, picture link
// and traits on the NFT itself (one bundled transaction, so it all lands or none of it does).
// Look first (changes nothing):  npx tsx scripts/mint-portal.ts <portal 1-500> <0x wallet or Portaldot account>
// Really mint:                   npx tsx scripts/mint-portal.ts <portal> <recipient> --yes
// Leave out the attributes:      add --no-attributes
// The issuer key is read from env ISSUER_MNEMONIC only (or .env.local). It is never printed or saved.
// The collection comes from PORTAL_COLLECTION_ID (set it to the new collection number after create-collection.mjs --yes).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
process.env.PORTAL_COLLECTION_ID ||= "5";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const withAttributes = !args.includes("--no-attributes");
const [idArg, to] = args.filter((a) => !a.startsWith("--"));
const id = Number(idArg);

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!Number.isInteger(id) || id < 1 || id > 500 || !to)
  stop("Usage: npx tsx scripts/mint-portal.ts <portal 1-500> <0x wallet or Portaldot account> [--yes] [--no-attributes]");

async function main() {
  const { PORTALDOT_CONSOLE, PORTAL_COLLECTION_ID } = await import("../lib/types");
  const { portalOwners, recipientAccount, getApi } = await import("../lib/native");
  const { portalAttributes, attributeDeposit } = await import("../lib/portalAttributes");
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");

  try {
    const api = await getApi();
    const decimals = api.registry.chainDecimals[0] ?? 18;
    const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);
    const account = recipientAccount(to);
    const owner = (await portalOwners([id])).get(id);
    if (owner) stop(`Portal #${id} is already minted (owner ${owner}). Nothing to do.`);

    const col = PORTAL_COLLECTION_ID;
    const colInfo = (await api.query.nfts.collection(col)) as unknown as { isSome: boolean };
    const collectionThere = colInfo.isSome;

    const calls = [api.tx.nfts.mint(col, id, account, null)];
    let attrDeposit = 0n;
    if (withAttributes) {
      const all = JSON.parse(readFileSync(path.join(process.cwd(), "data", "portals.json"), "utf8")) as Parameters<typeof portalAttributes>[0][];
      const portal = all.find((p) => p.id === id);
      if (!portal) stop(`Portal #${id} is not in data/portals.json.`);
      const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://portalsweeper.vercel.app";
      const attrs = portalAttributes(portal, origin);
      for (const a of attrs) calls.push(api.tx.nfts.setAttribute(col, id, { CollectionOwner: null }, a.key, a.value));
      attrDeposit = attributeDeposit(attrs, BigInt(api.consts.nfts.attributeDepositBase.toString()), BigInt(api.consts.nfts.depositPerByte.toString()));
      console.log(`Written on the Portal: ${attrs.map((a) => `${a.key} (${a.value.length} chars)`).join(", ")}.`);
    }
    const needed = BigInt(api.consts.nfts.itemDeposit.toString()) + attrDeposit;
    const tx = calls.length === 1 ? calls[0] : api.tx.utility.batchAll(calls);

    await cryptoWaitReady();
    const mnemonic = process.env.ISSUER_MNEMONIC;
    const issuer = mnemonic ? new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim()) : null;
    const balance = issuer ? ((await api.query.system.account(issuer.address)) as unknown as { data: { free: { toString(): string } } }).data.free : null;
    let fee = "unknown";
    try {
      if (issuer) fee = fmt((await tx.paymentInfo(issuer)).partialFee);
    } catch {
      /* the estimate can fail while the collection does not exist yet */
    }

    console.log(`Portal #${id} is not minted yet. It would go to ${account}.`);
    console.log(`Collection ${col}: ${collectionThere ? "found on the chain" : "NOT found on the chain yet (create it first, then set PORTAL_COLLECTION_ID)"}.`);
    console.log(`Locks about ${fmt(needed)} tPOT in deposits plus a fee of about ${fee} tPOT. The issuer wallet holds ${balance ? fmt(balance) : "?"} tPOT.`);

    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to really mint it.");
    } else {
      if (!issuer || !balance) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
      if (!collectionThere) stop(`Collection ${col} does not exist on the chain, so nothing was sent.`);
      if (BigInt(balance.toString()) < needed) stop("The issuer wallet does not hold enough tPOT for the deposits. Nothing was sent.");
      const r = await new Promise<{ txHash: string; block: number }>((resolve, reject) => {
        tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
          if (dispatchError) {
            const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
            reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
          } else if (status.isInBlock) {
            api.rpc.chain.getHeader(status.asInBlock).then((h) => resolve({ txHash: txHash.toHex(), block: h.number.toNumber() })).catch(reject);
          }
        }).catch(reject);
      });
      console.log(`Minted Portal #${id} to ${account}`);
      console.log(`Transaction ${r.txHash}`);
      console.log(`Block ${r.block}: ${PORTALDOT_CONSOLE}#/explorer/query/${r.block}`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  (await getApi()).disconnect().catch(() => {});
}

main().then(() => process.exit(process.exitCode ?? 0));
