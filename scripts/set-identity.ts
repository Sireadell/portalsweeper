// Puts an official name on the issuer wallet using Portaldot's built-in Identity module,
// so the name shows next to the address on the chain explorer and on our Hall page.
// Look first (changes nothing):  npx tsx scripts/set-identity.ts "Portalsweeper" --web https://portalsweeper.vercel.app --twitter portalsweeper
// Really set it:                 add --yes
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

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const display = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const web = flag("web");
const twitter = flag("twitter");

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!display || display.length > 32) stop('Usage: npx tsx scripts/set-identity.ts "<name, up to 32 characters>" [--web <link>] [--twitter <handle>] [--yes]');

async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { getApi } = await import("../lib/native");
  const { namesOfAccounts } = await import("../lib/identity");

  try {
    const mnemonic = process.env.ISSUER_MNEMONIC;
    if (!mnemonic) stop("ISSUER_MNEMONIC is not set. Nothing was sent.");
    await cryptoWaitReady();
    const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
    const api = await getApi();
    const decimals = api.registry.chainDecimals[0] ?? 18;
    const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);

    const info: Record<string, { Raw: string } | null> = {
      display: { Raw: display! },
      web: web ? { Raw: web } : null,
      twitter: twitter ? { Raw: twitter } : null,
    };
    const bytes = new TextEncoder().encode([display, web, twitter].filter(Boolean).join("")).length;
    const deposit = BigInt(api.consts.identity.basicDeposit.toString()) + BigInt(api.consts.identity.byteDeposit.toString()) * BigInt(bytes);
    const tx = api.tx.identity.setIdentity(info);
    const balance = ((await api.query.system.account(issuer.address)) as unknown as { data: { free: { toString(): string } } }).data.free;
    let fee = "unknown";
    try {
      fee = fmt((await tx.paymentInfo(issuer)).partialFee);
    } catch {
      /* some nodes only estimate fees for funded accounts */
    }
    const [current] = await namesOfAccounts(api, [issuer.address]);
    console.log(`Issuer ${issuer.address} holds ${fmt(balance)} tPOT. Current on-chain name: ${current ?? "none"}.`);
    console.log(`Would set the name "${display}"${web ? `, web ${web}` : ""}${twitter ? `, twitter ${twitter}` : ""}.`);
    console.log(`Locks a deposit of about ${fmt(deposit)} tPOT (returned if the name is removed) plus a fee of about ${fee} tPOT.`);

    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to really set the name.");
      return;
    }
    if (BigInt(balance.toString()) < deposit) stop("The issuer wallet does not hold enough tPOT for the deposit. Nothing was sent.");
    const hash = await new Promise<string>((resolve, reject) => {
      tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
        if (dispatchError) {
          const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
          reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
        } else if (status.isInBlock) resolve(txHash.toHex());
      }).catch(reject);
    });
    const [after] = await namesOfAccounts(api, [issuer.address]);
    console.log(`Name set. Transaction ${hash}. Read back from the chain: ${after ?? "(not readable yet)"}.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  (await getApi()).disconnect().catch(() => {});
}

main().then(() => process.exit(process.exitCode ?? 0));
