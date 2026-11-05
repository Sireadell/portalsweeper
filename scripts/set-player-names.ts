// Gives the two test wallets a name on Portaldot's Identity module, sent from each normal 0x wallet
// through the runtime pallets address (revive.ethSubstrateCall, see scripts/test-ethsubstrate.ts).
// Look first (changes nothing):  npx tsx scripts/set-player-names.ts
// Really set them, A then B:     npx tsx scripts/set-player-names.ts --yes
// Keys come from .env.local (PLAYER_A_PRIVATE_KEY, PLAYER_B_PRIVATE_KEY) and are never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot as chain } from "../lib/portaldot";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const yes = process.argv.includes("--yes");
const PEOPLE = [
  { env: "PLAYER_A_PRIVATE_KEY", expect: "0x3E5E603dcEc9F5aa559cb7Be470ea0997EdCf62e", name: "Player A" },
  { env: "PLAYER_B_PRIVATE_KEY", expect: "0x9833afD5f9D1007d88CfA3BE9e6c700e0949f9F3", name: "Player B" },
];

async function main() {
  const { getApi, mappedAccount } = await import("../lib/native");
  const { namesOfAccounts } = await import("../lib/identity");
  const { ethCallData, PALLETS_ADDRESS } = await import("../lib/swap");
  const api = await getApi();
  const pub = createPublicClient({ chain, transport: http() });
  const fmt = (v: bigint) => (Number(v) / 1e18).toFixed(4);

  for (const p of PEOPLE) {
    const raw = process.env[p.env];
    if (!raw) throw new Error(`${p.env} is not set. Nothing was sent.`);
    const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
    if (account.address.toLowerCase() !== p.expect.toLowerCase()) throw new Error(`${p.env} is not the expected wallet. Nothing was sent.`);
    const native = mappedAccount(account.address);
    const [current] = await namesOfAccounts(api, [native]);
    const bytes = new TextEncoder().encode(p.name).length;
    const deposit = BigInt(api.consts.identity.basicDeposit.toString()) + BigInt(api.consts.identity.byteDeposit.toString()) * BigInt(bytes);
    const balance = await pub.getBalance({ address: account.address });
    const info = { display: { Raw: p.name }, web: null, twitter: null };
    const data = ethCallData(api.tx.identity.setIdentity(info as never));
    let est = "refused";
    let gas = 0n;
    try {
      gas = await pub.estimateGas({ account: account.address, to: PALLETS_ADDRESS, data, value: 0n });
      est = `accepted, gas ${gas}`;
    } catch (e) {
      const x = e as { details?: string; shortMessage?: string };
      est = `refused: ${(x.details ?? x.shortMessage ?? (e as Error).message).slice(0, 300)}`;
    }
    console.log(`${p.name} ${account.address}: holds ${fmt(balance)} tPOT, current name ${current ?? "none"}, deposit about ${fmt(deposit)} tPOT, estimate ${est}`);
    if (!yes) continue;
    if (!gas) throw new Error(`The node refused the ${p.name} call, stopping. Nothing more was sent.`);
    if (balance < deposit) throw new Error(`${p.name} does not hold enough tPOT for the deposit. Stopping.`);
    const wallet = createWalletClient({ account, chain, transport: http() });
    const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data, value: 0n });
    const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    const [after] = await namesOfAccounts(api, [native]);
    const balAfter = await pub.getBalance({ address: account.address });
    console.log(`  tx ${hash} block ${rcpt.blockNumber} status ${rcpt.status}; name read back: ${after ?? "(none)"}; balance change ${fmt(balance - balAfter)} tPOT`);
    if (after !== p.name) throw new Error(`${p.name} was not readable after the transaction, stopping.`);
  }
  if (!yes) console.log("Dry run: nothing was sent. Add --yes to really set the names.");
}

main().then(() => process.exit(0)).catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
