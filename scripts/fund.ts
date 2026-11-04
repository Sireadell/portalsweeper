// Sends test tPOT from the issuer account to a wallet (0x or Portaldot account).
// Look first (sends nothing):  npx tsx scripts/fund.ts <recipient> <tPOT>
// Really send:                 npx tsx scripts/fund.ts <recipient> <tPOT> --yes
// The issuer key is read from env ISSUER_MNEMONIC only. It is never printed or saved.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { Keyring } from "@polkadot/keyring";

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

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!to || !amountArg || !/^\d+(\.\d+)?$/.test(amountArg)) stop("Usage: npx tsx scripts/fund.ts <0x wallet or Portaldot account> <tPOT> [--yes]");

async function main() {
  const { getApi, recipientAccount } = await import("../lib/native");
  const api = await getApi();
  try {
    const dest = recipientAccount(to);
    const decimals = api.registry.chainDecimals[0];
    const [whole, frac = ""] = amountArg.split(".");
    const planck = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals));
    const bal = async (a: string) => ((await api.query.system.account(a)) as unknown as { data: { free: { toBigInt(): bigint } } }).data.free.toBigInt();
    const show = (v: bigint) => (Number(v / 10n ** BigInt(decimals - 4)) / 10000).toFixed(4);
    console.log(`Would send ${amountArg} tPOT to ${dest} (now holds ${show(await bal(dest))} tPOT).`);
    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to send it.");
    } else {
      const mnemonic = process.env.ISSUER_MNEMONIC;
      if (!mnemonic) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
      await cryptoWaitReady();
      const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
      const hash = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for a block.")), 60_000);
        api.tx.balances.transferKeepAlive(dest, planck).signAndSend(issuer, ({ status, dispatchError, txHash }) => {
          if (dispatchError) {
            clearTimeout(timer);
            reject(new Error(dispatchError.isModule ? (() => { const m = api.registry.findMetaError(dispatchError.asModule); return `${m.section}.${m.name}`; })() : dispatchError.toString()));
          } else if (status.isInBlock) {
            clearTimeout(timer);
            resolve(txHash.toHex());
          }
        }).catch(reject);
      });
      console.log(`Sent. Transaction ${hash}`);
      console.log(`${dest} now holds ${show(await bal(dest))} tPOT.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  await api.disconnect().catch(() => {});
}

main().then(() => process.exit(process.exitCode ?? 0));
