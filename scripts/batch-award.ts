// Pays out one day's award in a single transaction: mint the Portal, write its traits, pay SHARD, write a ledger note.
// Look first (changes nothing):  npx tsx scripts/batch-award.ts <portal 1-500> <0x wallet or account> [--date 2026-11-05] [--shard 1]
// Really send (issuer signs):    add --yes
// The issuer key is read from env ISSUER_MNEMONIC only (or .env.local). It is never printed or saved.
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
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const flagVals = new Set([opt("--date", ""), opt("--shard", "")]);
const [idArg, to] = args.filter((a) => !a.startsWith("--") && !flagVals.has(a));
const id = Number(idArg);
const date = opt("--date", new Date().toISOString().slice(0, 10));
const shardAmount = BigInt(opt("--shard", "1"));

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!Number.isInteger(id) || id < 1 || id > 500 || !to) stop("Usage: npx tsx scripts/batch-award.ts <portal 1-500> <0x wallet or account> [--date YYYY-MM-DD] [--shard N] [--yes]");

async function main() {
  const { PORTAL_COLLECTION_ID } = await import("../lib/types");
  const { portalOwners, recipientAccount, getApi } = await import("../lib/native");
  const { portalAttributes, attributeDeposit } = await import("../lib/portalAttributes");
  const { awardBatchTx, awardNote } = await import("../lib/batch");
  const { shardAssetId } = await import("../lib/shardToken");
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  try {
    const api = await getApi();
    const decimals = api.registry.chainDecimals[0] ?? 14;
    const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);
    const account = recipientAccount(to);
    if ((await portalOwners([id])).get(id)) stop(`Portal #${id} is already minted. Nothing to do.`);
    const colThere = ((await api.query.nfts.collection(PORTAL_COLLECTION_ID)) as unknown as { isSome: boolean }).isSome;
    const assetId = shardAssetId();
    const shardThere = ((await api.query.assets.asset(assetId)) as unknown as { isSome: boolean }).isSome;
    const all = JSON.parse(readFileSync(path.join(process.cwd(), "data", "portals.json"), "utf8")) as Parameters<typeof portalAttributes>[0][];
    const portal = all.find((p) => p.id === id);
    if (!portal) stop(`Portal #${id} is not in data/portals.json.`);
    const attrs = portalAttributes(portal, process.env.NEXT_PUBLIC_SITE_URL ?? "https://portalsweeper.vercel.app");
    const note = awardNote(date, id, to);
    const amount = shardThere ? shardAmount : 0n;
    const tx = awardBatchTx(api as never, { collection: PORTAL_COLLECTION_ID, portal: id, recipient: account, attributes: attrs, shardAssetId: assetId, shardAmount: amount, note }) as ReturnType<typeof api.tx.utility.batchAll>;
    const deposit = BigInt(api.consts.nfts.itemDeposit.toString()) + attributeDeposit(attrs, BigInt(api.consts.nfts.attributeDepositBase.toString()), BigInt(api.consts.nfts.depositPerByte.toString()));
    await cryptoWaitReady();
    const mnemonic = process.env.ISSUER_MNEMONIC;
    const issuer = mnemonic ? new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim()) : null;
    const balance = issuer ? ((await api.query.system.account(issuer.address)) as unknown as { data: { free: { toString(): string } } }).data.free : null;
    let fee = "unknown";
    try {
      if (issuer) fee = fmt((await tx.paymentInfo(issuer)).partialFee);
    } catch (e) {
      fee = `estimate failed (${e instanceof Error ? e.message.split("\n")[0] : e})`;
    }

    console.log(`Batch for ${date}, ONE transaction (Utility.batchAll):`);
    console.log(`  1. Nfts.mint  collection ${PORTAL_COLLECTION_ID} Portal #${id} -> ${account} (${colThere ? "collection found" : "collection NOT found"})`);
    console.log(`  2. Nfts.setAttribute x${attrs.length}  (${attrs.map((a) => a.key).join(", ")})`);
    console.log(amount > 0n ? `  3. Assets.mint  SHARD asset ${assetId}: ${amount} -> ${account}` : `  3. SHARD step left out (asset ${assetId} ${shardThere ? "amount 0" : "does not exist yet"})`);
    console.log(`  4. System.remarkWithEvent  "${note}"`);
    console.log(`Locks about ${fmt(deposit)} tPOT in deposits plus a fee of about ${fee} tPOT. The issuer wallet holds ${balance ? fmt(balance) : "?"} tPOT.`);

    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to really send it.");
    } else {
      if (!issuer || !balance) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
      if (!colThere) stop("The collection does not exist on the chain, so nothing was sent.");
      if (BigInt(balance.toString()) < deposit) stop("The issuer wallet does not hold enough tPOT for the deposits. Nothing was sent.");
      const r = await new Promise<{ txHash: string; block: number }>((resolve, reject) => {
        tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
          if (dispatchError) {
            const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
            reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
          } else if (status.isInBlock) api.rpc.chain.getHeader(status.asInBlock).then((h) => resolve({ txHash: txHash.toHex(), block: h.number.toNumber() })).catch(reject);
        }).catch(reject);
      });
      console.log(`Award sent. Transaction ${r.txHash} in block ${r.block}.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  (await getApi()).disconnect().catch(() => {});
}
main().then(() => process.exit(process.exitCode ?? 0));
