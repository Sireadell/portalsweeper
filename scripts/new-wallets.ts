// Makes the test-only wallets used for deploys and test runs and saves their keys in .env.local (never printed).
// Run: npx tsx scripts/new-wallets.ts
// Prints only addresses: the 0x address and the Portaldot (5...) account that tPOT must be sent to.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mappedAccount } from "../lib/native";

const envFile = path.join(process.cwd(), ".env.local");
const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const have = (name: string) => new RegExp(`^${name}=`, "m").test(text);

const NAMES = ["DEPLOYER_PRIVATE_KEY", "ESCROW_PRIVATE_KEY", "PLAYER_A_PRIVATE_KEY", "PLAYER_B_PRIVATE_KEY"];

let keys: Record<string, string> = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) keys[m[1]] = m[2].trim();
}
let added = "";
for (const n of NAMES) {
  if (!have(n)) {
    keys[n] = generatePrivateKey();
    added += `${n}=${keys[n]}\n`;
  }
}
if (added) appendFileSync(envFile, (text && !text.endsWith("\n") ? "\n" : "") + added);

for (const n of NAMES) {
  const a = privateKeyToAccount(keys[n] as `0x${string}`);
  console.log(`${n.replace("_PRIVATE_KEY", "").padEnd(8)} 0x: ${a.address}   Portaldot account: ${mappedAccount(a.address)}`);
}
console.log(added ? "New keys saved in .env.local (kept out of git)." : "Keys already in .env.local, nothing new made.");
