// Mints one Portal to a winner by hand, signed by the collection issuer.
// Look first (changes nothing):  npx tsx scripts/mint-portal.ts <portal 1-500> <0x wallet or Portaldot account>
// Really mint:                   npx tsx scripts/mint-portal.ts <portal> <recipient> --yes
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
const [idArg, to] = args.filter((a) => !a.startsWith("--"));
const id = Number(idArg);

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!Number.isInteger(id) || id < 1 || id > 500 || !to)
  stop("Usage: npx tsx scripts/mint-portal.ts <portal 1-500> <0x wallet or Portaldot account> [--yes]");

async function main() {
  const { PORTALDOT_CONSOLE } = await import("../lib/types");
  const { mintPortal, portalOwners, recipientAccount, getApi } = await import("../lib/native");

  try {
    const account = recipientAccount(to);
    const owner = (await portalOwners([id])).get(id);
    if (owner) stop(`Portal #${id} is already minted (owner ${owner}). Nothing to do.`);
    console.log(`Portal #${id} is not minted yet. It would go to ${account}.`);
    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to really mint it.");
    } else {
      if (!process.env.ISSUER_MNEMONIC) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
      const r = await mintPortal(id, to);
      console.log(`Minted Portal #${id} to ${r.to}`);
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
