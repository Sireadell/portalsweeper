// Checks which settings the chain features need are present. Prints only names and SET or MISSING, never a value.
// Run:  npx tsx scripts/chain-env-check.ts
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
const fromFile = new Set<string>();
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && m[2].trim().replace(/^"(.*)"$/, "$1")) fromFile.add(m[1]);
  }
}
const isSet = (name: string) => !!process.env[name]?.trim() || fromFile.has(name);

const groups: { title: string; counts: boolean; names: [string, string][] }[] = [
  {
    title: "Game server",
    counts: true,
    names: [
      ["CRON_SECRET", "lets only the daily timer call the cron routes"],
      ["PORTAL_SALT_SECRET", "the secret behind every daily board"],
      ["POSTER_PRIVATE_KEY", "wallet that posts the daily fingerprint and writes to the ledger"],
      ["ISSUER_MNEMONIC", "the wallet that mints Portals"],
      ["PORTAL_COLLECTION_ID", "which collection the server mints from"],
      ["NEXT_PUBLIC_PORTAL_COLLECTION_ID", "the same number, for the web page"],
    ],
  },
  {
    title: "Storage (one of these is enough)",
    counts: false,
    names: [
      ["REDIS_URL", "a normal Redis"],
      ["KV_REST_API_URL", "Vercel KV address (needs the token too)"],
      ["KV_REST_API_TOKEN", "Vercel KV token"],
      ["UPSTASH_REDIS_REST_URL", "Upstash address (needs the token too)"],
      ["UPSTASH_REDIS_REST_TOKEN", "Upstash token"],
    ],
  },
  {
    title: "Chain features (each one switches a feature on)",
    counts: false,
    names: [
      ["LEDGER_ADDRESS", "the ledger contract; without it daily fingerprints stay plain notes"],
      ["RANDOM_FROM", "turns on the chain random number in each day's board"],
      ["SHARD_ASSET_ID", "the SHARD token (a default number is used when missing)"],
      ["DEPLOYER_PRIVATE_KEY", "only for deploying the ledger by hand"],
      ["ESCROW_PRIVATE_KEY", "only for real stakes"],
    ],
  },
];

let missing = 0;
for (const g of groups) {
  console.log(`\n${g.title}`);
  for (const [name, why] of g.names) {
    const ok = isSet(name);
    if (!ok && g.counts) missing++;
    console.log(`  ${ok ? "SET    " : "MISSING"}  ${name}  (${why})`);
  }
}
console.log(missing ? `\n${missing} setting(s) the game server needs are missing here.` : "\nThe game server settings are all present here.");
