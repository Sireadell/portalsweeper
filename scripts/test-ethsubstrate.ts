// Tests whether pallet-revive's ethSubstrateCall works from a normal 0x wallet: an Ethereum-signed
// transaction sent to the "runtime pallets" address carries a native call (here the harmless system.remarkWithEvent).
// Look first (changes nothing, only asks the node):   npx tsx scripts/test-ethsubstrate.ts
// Send it for real from the deployer wallet:          npx tsx scripts/test-ethsubstrate.ts --send
// The key comes from env DEPLOYER_PRIVATE_KEY or .env.local and is never printed. Costs a normal fee only.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portaldot as chain } from "../lib/portaldot";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

// Read from the chain: the address that stands for "the runtime's pallets".
export const PALLETS_ADDRESS = "0x6d6f646c70792f70616464720000000000000000" as const;

const send = process.argv.includes("--send");
const note = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "portalsweeper ethSubstrateCall test";

async function main() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw) throw new Error("DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
  const pub = createPublicClient({ chain, transport: http() });

  // The native call, SCALE encoded exactly as the runtime expects it.
  const call = api.tx.system.remarkWithEvent(toHex(note));
  const data = call.method.toHex() as Hex;
  console.log("native call:", `${call.method.section}.${call.method.method}`, "encoded bytes:", (data.length - 2) / 2);
  console.log("wallet:", account.address, "balance (EVM units):", (await pub.getBalance({ address: account.address })).toString());

  // Dry run 1: ask the node what it thinks of the transaction.
  try {
    const gas = await pub.estimateGas({ account: account.address, to: PALLETS_ADDRESS, data, value: 0n });
    console.log("DRY RUN estimateGas: accepted, gas", gas.toString());
  } catch (e) {
    console.log("DRY RUN estimateGas: refused:", (e as Error).message.split("\n")[0].slice(0, 300));
  }

  if (!send) {
    console.log("Nothing was sent. Add --send to send it from the deployer wallet.");
    process.exit(0);
  }

  const wallet = createWalletClient({ account, chain, transport: http() });
  const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data, value: 0n });
  console.log("sent:", hash);
  const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  console.log("receipt status:", rcpt.status, "block:", rcpt.blockNumber.toString());

  // Look at that block's native events for the remark.
  const blockHash = await api.rpc.chain.getBlockHash(Number(rcpt.blockNumber));
  const events = (await (await api.at(blockHash)).query.system.events()) as unknown as { toHuman(): unknown }[];
  const hits = events.map((e) => JSON.stringify(e.toHuman())).filter((s) => /Remarked|EthSubstrateCall|ethSubstrate/i.test(s));
  console.log("native events that mention the remark:", hits.length ? hits : "none");
  process.exit(0);
}

main().catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
