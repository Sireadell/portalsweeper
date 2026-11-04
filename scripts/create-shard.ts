// Makes the SHARD token with the Assets module (about 1 tPOT deposit), owned by the issuer wallet.
// Look first (sends nothing):  npx tsx scripts/create-shard.ts
// Really create:               npx tsx scripts/create-shard.ts --yes
// The issuer key comes from env ISSUER_MNEMONIC or .env.local and is never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const yes = process.argv.includes("--yes");

async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { getApi } = await import("../lib/native");
  const { SHARD_DECIMALS, SHARD_MIN_BALANCE, SHARD_NAME, SHARD_SYMBOL, assetErc20Address, shardAssetId } = await import("../lib/shardToken");

  const mnemonic = process.env.ISSUER_MNEMONIC;
  if (!mnemonic) throw new Error("ISSUER_MNEMONIC is not set. Run scripts/new-issuer.ts first.");
  await cryptoWaitReady();
  const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
  const api = await getApi();
  const id = shardAssetId();
  const decimals = api.registry.chainDecimals[0] ?? 18;
  const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);

  const existing = await api.query.assets.asset(id);
  if (existing.isSome) throw new Error(`Asset ${id} already exists on the chain. Set SHARD_ASSET_ID to a free number. Nothing was sent.`);

  const create = api.tx.assets.create(id, issuer.address, SHARD_MIN_BALANCE);
  const meta = api.tx.assets.setMetadata(id, SHARD_NAME, SHARD_SYMBOL, SHARD_DECIMALS);
  const batch = api.tx.utility.batchAll([create, meta]);
  const balance = (await api.query.system.account(issuer.address)).data.free;
  const deposit = api.consts.assets.assetDeposit;
  let fee = "unknown";
  try {
    fee = fmt((await batch.paymentInfo(issuer)).partialFee);
  } catch {
    /* some nodes only estimate fees for funded accounts */
  }
  console.log(`Issuer ${issuer.address} holds ${fmt(balance)} tPOT.`);
  console.log(`Asset ${id} is free. Creating ${SHARD_SYMBOL} locks a deposit of ${fmt(deposit)} tPOT (plus a little for the name) and costs a fee of about ${fee} tPOT.`);
  console.log(`Once made it will be readable as an ERC-20 token at ${assetErc20Address(id)}.`);

  if (!yes) {
    console.log("Dry run: nothing was sent. Add --yes to really create the token.");
    return;
  }
  if (BigInt(balance.toString()) < BigInt(deposit.toString())) throw new Error("The issuer wallet does not hold enough tPOT for the deposit. Nothing was sent.");

  const hash = await new Promise<string>((resolve, reject) => {
    batch
      .signAndSend(issuer, ({ status, dispatchError }) => {
        if (dispatchError) {
          const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
          reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
        } else if (status.isInBlock) resolve(status.asInBlock.toHex());
      })
      .catch(reject);
  });
  console.log(`Created in block ${hash}. Set SHARD_ASSET_ID=${id} on the server.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .then(() => process.exit(process.exitCode ?? 0));
