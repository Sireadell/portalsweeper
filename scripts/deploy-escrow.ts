// Puts the StakeEscrow contract on Portaldot V3 (EVM side).
// Look first (sends nothing):  npx tsx scripts/deploy-escrow.ts
// Really deploy:               npx tsx scripts/deploy-escrow.ts --yes
// The deploying wallet comes from env DEPLOYER_PRIVATE_KEY (or .env.local). The key is never printed or saved.
// The referee is the only wallet that can name a winner. Default: the deploying wallet. Pass --referee 0x... for another one.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../contracts/StakeEscrow.json";
import { portaldot as chain } from "../lib/portaldot";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const ri = args.indexOf("--referee");
const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
if (!key) {
  console.error("DEPLOYER_PRIVATE_KEY is not set.");
  process.exit(1);
}

async function main() {
  const account = privateKeyToAccount((key!.startsWith("0x") ? key! : `0x${key}`) as Hex);
  const referee = (ri >= 0 ? args[ri + 1] : account.address) as Hex;
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });
  const bytecode = artifact.bytecode as Hex;
  const balance = await pub.getBalance({ address: account.address });
  console.log(`Contract code: ${(bytecode.length - 2) / 2} bytes. Deploying wallet ${account.address} holds ${formatEther(balance)} tPOT. Referee will be ${referee}.`);
  try {
    const gas = await pub.estimateGas({ account, data: encodeDeployData({ abi: artifact.abi, bytecode, args: [referee] }) });
    const price = await pub.getGasPrice();
    console.log(`Estimated gas: ${gas}. At the current price that is about ${formatEther(gas * price)} tPOT, most of it a deposit.`);
  } catch (e) {
    console.log(`Could not estimate the deploy yet: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  if (!yes) {
    console.log("Dry run: nothing was sent. Add --yes to deploy.");
    return;
  }
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode, args: [referee] });
  console.log(`Deploy sent. Transaction ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`The deploy did not succeed (status ${receipt.status}).`);
  const code = await pub.getCode({ address: receipt.contractAddress });
  console.log(`Deployed at ${receipt.contractAddress} in block ${receipt.blockNumber}. Code on chain: ${((code?.length ?? 2) - 2) / 2} bytes.`);
  console.log(`Next: set ESCROW_CONTRACT_ADDRESS=${receipt.contractAddress} on the server.`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
