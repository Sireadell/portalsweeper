// Pays out SHARD tokens to a player: the issuer wallet mints them straight into the player's account.
// Look first (changes nothing):  npx tsx scripts/mint-shard.ts <0x wallet or Portaldot account> <amount>
// Really pay out:                npx tsx scripts/mint-shard.ts <recipient> <amount> --yes
// The token must exist first (scripts/create-shard.ts --yes). The issuer key comes from env ISSUER_MNEMONIC or .env.local, never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [to, amountArg] = args.filter((a) => !a.startsWith("--"));
const amount = Number(amountArg);

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!to || !Number.isInteger(amount) || amount < 1 || amount > 1000)
  stop("Usage: npx tsx scripts/mint-shard.ts <0x wallet or Portaldot account> <amount 1-1000> [--yes]");

async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { getApi, recipientAccount } = await import("../lib/native");
  const { SHARD_SYMBOL, assetErc20Address, shardAssetId } = await import("../lib/shardToken");

  try {
    const api = await getApi();
    const id = shardAssetId();
    const account = recipientAccount(to);
    const decimals = api.registry.chainDecimals[0] ?? 18;
    const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);
    const exists = ((await api.query.assets.asset(id)) as unknown as { isSome: boolean }).isSome;

    await cryptoWaitReady();
    const mnemonic = process.env.ISSUER_MNEMONIC;
    const issuer = mnemonic ? new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim()) : null;
    const tx = api.tx.assets.mint(id, account, amount);
    let fee = "unknown";
    try {
      if (issuer) fee = fmt((await tx.paymentInfo(issuer)).partialFee);
    } catch {
      /* the estimate can fail while the token does not exist yet */
    }
    console.log(`Would mint ${amount} ${SHARD_SYMBOL} (asset ${id}) to ${account}. Fee about ${fee} tPOT, no deposit.`);
    console.log(`Token ${exists ? "found on the chain" : "NOT made yet (run scripts/create-shard.ts --yes first)"}; ERC-20 address ${assetErc20Address(id)}.`);

    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to really pay out.");
      return;
    }
    if (!issuer) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
    if (!exists) stop("The SHARD token does not exist yet, so nothing was sent.");
    const hash = await new Promise<string>((resolve, reject) => {
      tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
        if (dispatchError) {
          const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
          reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
        } else if (status.isInBlock) resolve(txHash.toHex());
      }).catch(reject);
    });
    console.log(`Paid out ${amount} ${SHARD_SYMBOL}. Transaction ${hash}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  (await getApi()).disconnect().catch(() => {});
}

main().then(() => process.exit(process.exitCode ?? 0));
