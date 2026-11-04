// Fallback way to put the DailyLedger contract on Portaldot V3: send it as a normal Portaldot (5...) transaction
// with revive.instantiateWithCode, for the case where the 0x route (scripts/deploy-ledger.ts) is refused.
// Look first (sends nothing, free):  npx tsx scripts/deploy-ledger-native.ts --writer 0x...
// Really deploy:                     npx tsx scripts/deploy-ledger-native.ts --writer 0x... --yes
// The paying wallet is the issuer key (env ISSUER_MNEMONIC or .env.local), never printed. The writer is the 0x wallet
// the daily job uses (the one behind POSTER_PRIVATE_KEY); it is the only wallet allowed to write to the ledger.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { encodeAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../contracts/DailyLedger.json";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const wi = args.indexOf("--writer");

function writerAddress(): Hex {
  if (wi >= 0) {
    const w = args[wi + 1];
    if (!/^0x[0-9a-fA-F]{40}$/.test(w ?? "")) throw new Error("--writer must be a 0x wallet address.");
    return w as Hex;
  }
  const key = process.env.POSTER_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Pass --writer 0x... (the wallet the daily job uses), or set POSTER_PRIVATE_KEY.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex).address;
}

type DryRun = {
  result: { isOk: boolean; toString(): string };
  storageDeposit: { isCharge: boolean; asCharge: { toString(): string } };
};

async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { getApi } = await import("../lib/native");

  const mnemonic = process.env.ISSUER_MNEMONIC;
  if (!mnemonic) throw new Error("ISSUER_MNEMONIC is not set. Run scripts/new-issuer.ts first.");
  const writer = writerAddress();
  await cryptoWaitReady();
  const payer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim());
  const api = await getApi();
  const decimals = api.registry.chainDecimals[0] ?? 18;
  const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);

  // For EVM code the chain wants the constructor arguments glued onto the end of the code and no separate data.
  const code = `${artifact.bytecode}${encodeAbiParameters([{ type: "address" }], [writer]).slice(2)}` as Hex;
  const data = "0x" as Hex;
  const balance = ((await api.query.system.account(payer.address)) as unknown as { data: { free: { toString(): string } } }).data.free;
  console.log(`Contract code: ${(code.length - 2) / 2} bytes. Paying wallet ${payer.address} holds ${fmt(balance)} tPOT. Writer will be ${writer}.`);

  // Free dry run through the chain's own runtime API.
  let deposit: bigint | null = null;
  try {
    const dry = (await api.call.reviveApi.instantiate(payer.address, 0, null, null, { Upload: code }, data, null)) as unknown as DryRun;
    if (dry.result.isOk) {
      deposit = dry.storageDeposit.isCharge ? BigInt(dry.storageDeposit.asCharge.toString()) : 0n;
      console.log(`Dry run succeeded. Storage deposit about ${fmt(deposit)} tPOT, plus the fee.`);
    } else {
      const err = (dry.result as unknown as { asErr?: { isModule?: boolean; asModule?: unknown } }).asErr;
      let why = dry.result.toString().slice(0, 300);
      try {
        if (err?.isModule) {
          const m = api.registry.findMetaError(err.asModule as Parameters<typeof api.registry.findMetaError>[0]);
          why = `${m.section}.${m.name}`;
        }
      } catch {
        /* keep the raw text */
      }
      console.log(`Dry run was refused: ${why}`);
    }
  } catch (e) {
    console.log(`Could not run the dry run: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }

  if (!yes) {
    console.log("Dry run: nothing was sent. Add --yes to deploy.");
    return;
  }
  if (deposit === null) throw new Error("The dry run did not succeed, so nothing was sent.");
  if (BigInt(balance.toString()) < deposit) throw new Error("The paying wallet does not hold enough tPOT. Nothing was sent.");

  const tx = api.tx.revive.instantiateWithCode(0, { refTime: 0, proofSize: 0 }, deposit + deposit / 10n, code, data, null);
  const out = await new Promise<string>((resolve, reject) => {
    tx.signAndSend(payer, ({ status, events, dispatchError }) => {
      if (dispatchError) {
        const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
        reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
      } else if (status.isInBlock) {
        const inst = events.find(({ event }) => api.events.revive.Instantiated?.is(event));
        resolve(`${status.asInBlock.toHex()}${inst ? ` contract ${inst.event.data[1].toString()}` : ""}`);
      }
    }).catch(reject);
  });
  console.log(`Deployed in block ${out}. Next: set LEDGER_ADDRESS to that contract address on the server.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .then(() => process.exit(process.exitCode ?? 0));
