// B7 check: TransactionStorage.store must be a direct native transaction. This makes a throwaway Portaldot key,
// funds it with a little tPOT from the deployer wallet (a native balances call sent through the runtime pallets address),
// then stores a small replay log directly and reads the result back.
//   npx tsx scripts/storage-direct-test.ts [--amount 0.3]
// The throwaway recovery phrase is written to the file named in --keep (default: not saved) so leftovers can be swept.
// --phrase FILE reuses a kept throwaway key and tops it up. Each log line is about 38 bytes; the length fee is the main cost (about 0.1 tPOT per KB).
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady, mnemonicGenerate } = await import("@polkadot/util-crypto");
  const { ethCallData, PALLETS_ADDRESS } = await import("../lib/swap");
  const { storeCall, storeFee } = await import("../lib/storage");
  await cryptoWaitReady();

  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw) throw new Error("DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });

  const again = flag("phrase");
  const phrase = again ? readFileSync(again, "utf8").trim() : mnemonicGenerate();
  const kp = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromMnemonic(phrase);
  const keep = again ? undefined : flag("keep");
  if (keep) writeFileSync(keep, phrase + "\n");
  const amount = BigInt(Math.round(Number(flag("amount") ?? "0.3") * 1e14));
  console.log("throwaway account:", kp.address, "funding raw units:", amount.toString());

  const fund = api.tx.balances.transferKeepAlive(kp.address, amount);
  const hash = await wallet.sendTransaction({ to: PALLETS_ADDRESS, data: ethCallData(fund), value: 0n, gas: 2_000_000_000_000n });
  await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  console.log("funded by balances.transferKeepAlive through the pallets address:", hash);
  const bal = ((await api.query.system.account(kp.address)) as unknown as { data: { free: { toString(): string } } }).data.free.toString();
  console.log("throwaway balance:", bal);

  const log = Array.from({ length: 20 }, (_, i) => ({ action: "reveal", idx: i, t: i * 900 }));
  const bytes = new TextEncoder().encode(JSON.stringify(log)).length;
  console.log("chain storage fee for", bytes, "bytes:", (await storeFee(api, bytes)).toString());
  const done = await new Promise<{ block: string; txHash: string; events: string[] }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), 60_000);
    storeCall(api, log).signAndSend(kp, ({ status, dispatchError, txHash, events }) => {
      if (dispatchError) { clearTimeout(t); reject(new Error(dispatchError.toString())); return; }
      if (status.isInBlock) {
        clearTimeout(t);
        resolve({ block: status.asInBlock.toHex(), txHash: txHash.toHex(), events: events.map((e) => `${e.event.section}.${e.event.method}`) });
      }
    }).catch(reject);
  });
  console.log("DIRECT store in block", done.block, "tx", done.txHash, "events", done.events.join(","));
  process.exit(0);
}
main().catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
