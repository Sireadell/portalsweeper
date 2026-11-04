// Dry run for Portal swaps and the pre-signed mint. Nothing is sent: it builds the native calls from the live
// chain's metadata, then asks the node to estimate them as an Ethereum transaction from the deployer wallet.
// If the node refuses with a Nfts error (for example the Portal does not exist yet), the call did reach the Nfts module.
//   npx tsx scripts/portal-trade-dryrun.ts [--collection N] [--give 12] [--want 99]
// Keys come from .env.local and are never printed. The ticket is only signed on this machine, never submitted.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot as chain } from "../lib/portaldot";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const args = process.argv.slice(2);
const flag = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };

async function main() {
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { createSwapCall, claimSwapCall, ethCallData, PALLETS_ADDRESS } = await import("../lib/swap");
  const { signTicket, mintPreSignedCall } = await import("../lib/presigned");

  const collection = flag("collection", 5);
  const give = flag("give", 12);
  const want = flag("want", 99);
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw) throw new Error("DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
  const pub = createPublicClient({ chain, transport: http() });

  const ask = async (label: string, call: { method: { toHex(): string } }) => {
    const data = ethCallData(call as never);
    try {
      const gas = await pub.estimateGas({ account: account.address, to: PALLETS_ADDRESS, data, value: 0n });
      console.log(`${label}: node accepted, gas ${gas}`);
    } catch (e) {
      const x = e as { details?: string; shortMessage?: string };
      const m = (x.details ?? x.shortMessage ?? (e as Error).message).slice(0, 400);
      console.log(`${label}: node says: ${m}`);
    }
  };

  await ask(`createSwap Portal ${give} for ${want} (collection ${collection})`, createSwapCall(api, { give, want, collection }));
  await ask(`claimSwap send ${want} receive ${give}`, claimSwapCall(api, { send: want, receive: give, collection }));

  await cryptoWaitReady();
  const mnemonic = process.env.ISSUER_MNEMONIC;
  if (!mnemonic) throw new Error("ISSUER_MNEMONIC is not set.");
  const issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
  const head = (await api.rpc.chain.getHeader()).number.toNumber();
  const ticket = signTicket(api, issuer, { portal: 450, winner: account.address, deadlineBlock: head + 14_400, collection });
  console.log("ticket signed locally for Portal 450, deadline block", head + 14_400, "for", account.address);
  await ask("mintPreSigned Portal 450", mintPreSignedCall(api, ticket));
  process.exit(0);
}
main().catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
