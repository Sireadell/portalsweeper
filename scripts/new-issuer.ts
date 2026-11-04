// Makes a fresh issuer wallet for the Portal collection and saves its key to two private local files.
// Run:  npx tsx scripts/new-issuer.ts
// It prints only the public 5... address and where the key was saved, never the key itself.
// It refuses to run if an issuer key is already saved, so a key can never be overwritten by accident.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, mnemonicGenerate } from "@polkadot/util-crypto";

const envFile = path.join(process.cwd(), ".env.local");
const backupDir = path.join(os.homedir(), "wallet-keys");
const backupFile = path.join(backupDir, "portalsweeper-issuer.txt");

async function main() {
  const hasKeyInEnv = existsSync(envFile) && /^ISSUER_MNEMONIC=/m.test(readFileSync(envFile, "utf8"));
  if (hasKeyInEnv || existsSync(backupFile)) {
    console.error(`An issuer key is already saved (${hasKeyInEnv ? envFile : backupFile}). Nothing was changed.`);
    process.exit(1);
  }
  await cryptoWaitReady();
  const mnemonic = mnemonicGenerate(12);
  const address = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic).address;

  mkdirSync(backupDir, { recursive: true });
  writeFileSync(backupFile, `ISSUER_MNEMONIC="${mnemonic}"\nADDRESS=${address}\n`, { flag: "wx" });
  const lead = existsSync(envFile) && !readFileSync(envFile, "utf8").endsWith("\n") && readFileSync(envFile, "utf8").length > 0 ? "\n" : "";
  appendFileSync(envFile, `${lead}ISSUER_MNEMONIC="${mnemonic}"\n`);

  console.log(`New issuer address: ${address}`);
  console.log(`Key saved to ${envFile} (ignored by git) and backed up at ${backupFile}.`);
  console.log("Send it some tPOT, then run: node scripts/create-collection.mjs (a free dry run), and add --yes to really create the collection.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
