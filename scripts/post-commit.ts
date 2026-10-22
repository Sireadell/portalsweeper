// Posts a day's fingerprint to Portaldot (EVM side): a 0 value transaction from the poster wallet to itself,
// with the fingerprint as the data. Run: npx tsx scripts/post-commit.ts [YYYY-MM-DD] [--dry-run] [--local]
// The private key is read from env POSTER_PRIVATE_KEY only. It is never printed or saved.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PORTALDOT_CHAIN_ID } from "../lib/types";
import { portaldot as chain } from "../lib/portaldot";
import { dailyCommit, isValidDate, utcToday } from "../lib/salt";

// Load .env.local without printing anything (tsx does not do this for us).
const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const date = args.find((a) => !a.startsWith("--")) ?? utcToday();
const file = path.join(process.cwd(), "data", "commits.json");

type Row = { date: string; commit: string; txHash: string | null; block?: number };
const rows: Row[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];

function save() {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
}

async function main() {
  if (!isValidDate(date)) throw new Error(`Bad date "${date}". Use YYYY-MM-DD.`);
  // The live site holds the real secret, so by default the fingerprint is read from it. --local uses this machine's own secret.
  const site = process.env.POT_SITE ?? "https://potsweeper.vercel.app";
  const commit = args.includes("--local")
    ? dailyCommit(date)
    : ((await (await fetch(`${site}/api/salt?date=${date}`)).json()) as { commit: string }).commit;
  if (!/^0x[0-9a-fA-F]{64}$/.test(commit)) throw new Error("Could not read a fingerprint from the site.");
  const existing = rows.find((r) => r.date === date);
  if (existing?.txHash) {
    console.log(`Already posted for ${date}: ${existing.txHash}`);
    return;
  }

  const key = process.env.POSTER_PRIVATE_KEY;

  if (dry) {
    const from = key ? privateKeyToAccount(normalise(key)).address : "(poster wallet, from POSTER_PRIVATE_KEY)";
    console.log(`DRY RUN, nothing sent.\n  date:   ${date}\n  from:   ${from}\n  to:     the same wallet\n  value:  0 tPOT\n  data:   ${commit}\n  chain:  Portaldot V3 testnet (${PORTALDOT_CHAIN_ID})`);
    return;
  }

  if (!key) throw new Error("POSTER_PRIVATE_KEY is not set. Set it in the environment, then run again.");
  const account = privateKeyToAccount(normalise(key));
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });

  const balance = await pub.getBalance({ address: account.address });
  if (balance === 0n) throw new Error(`The poster wallet ${account.address} has no tPOT. Send it a small amount (0.1 tPOT is plenty) and run again.`);

  const hash = await wallet.sendTransaction({ to: account.address, value: 0n, data: commit as Hex });
  console.log(`Sent. Waiting for it to land: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The transaction failed: ${hash}`);

  const block = Number(receipt.blockNumber);
  if (existing) Object.assign(existing, { txHash: hash, block });
  else rows.push({ date, commit, txHash: hash, block });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  save();
  console.log(`Posted ${date} on Portaldot, block ${receipt.blockNumber}. Wallet balance left: ${formatEther(await pub.getBalance({ address: account.address }))} tPOT. Saved to data/commits.json.`);
}

function normalise(k: string): Hex {
  const t = k.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

main().catch((e) => {
  // Print only the message, never the environment.
  console.error(e instanceof Error ? e.message : "Failed.");
  process.exit(1);
});
