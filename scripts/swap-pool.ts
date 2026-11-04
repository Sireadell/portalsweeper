// A SHARD / tPOT swap pool with the Assets Conversion module (native, no contract), then a swap through it.
// Look first (changes nothing):
//   npx tsx scripts/swap-pool.ts setup [--tpot 5] [--shard 100]     create the pool and add the first liquidity
//   npx tsx scripts/swap-pool.ts swap  [--in tpot|shard] [--amount 0.1] [--slippage 5]   swap through the pool
// Really send (issuer signs): add --yes
// The issuer key is read from env ISSUER_MNEMONIC only (or .env.local). It is never printed or saved.
// The SHARD asset id comes from SHARD_ASSET_ID (default 5555). The issuer must hold the SHARD it adds.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const mode = args.find((a) => !a.startsWith("--") && (a === "setup" || a === "swap"));
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!mode) stop("Usage: npx tsx scripts/swap-pool.ts setup|swap [options] [--yes]");

async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { getApi } = await import("../lib/native");
  const { shardAssetId } = await import("../lib/shardToken");
  const { quoteOut, minOut, parseTpot14, feeDenominator } = await import("./swap-pool-math");
  try {
    const api = await getApi();
    const decimals = api.registry.chainDecimals[0] ?? 14;
    const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);
    const id = shardAssetId();
    const NATIVE = { Native: null };
    const SHARD = { WithId: id };
    const assetThere = ((await api.query.assets.asset(id)) as unknown as { isSome: boolean }).isSome;
    const poolKey = [{ native: null }, { withId: id }];
    const poolRaw = (await api.query.assetConversion.pools(poolKey)) as unknown as { isSome: boolean };
    const poolThere = poolRaw.isSome;
    const lpFee = BigInt(api.consts.assetConversion.lpFee.toString());
    const setupFee = BigInt(api.consts.assetConversion.poolSetupFee.toString());

    await cryptoWaitReady();
    const mnemonic = process.env.ISSUER_MNEMONIC;
    const issuer = mnemonic ? new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(mnemonic.trim()) : null;
    const free = issuer ? BigInt(((await api.query.system.account(issuer.address)) as unknown as { data: { free: { toString(): string } } }).data.free.toString()) : 0n;
    const shardBal = issuer && assetThere ? BigInt((((await api.query.assets.account(id, issuer.address)) as unknown as { toJSON(): { balance?: string | number } | null }).toJSON()?.balance ?? 0).toString()) : 0n;
    console.log(`SHARD asset ${id}: ${assetThere ? "exists" : "does NOT exist yet (create it first with scripts/create-shard.ts)"}. Pool tPOT/SHARD: ${poolThere ? "exists" : "not made yet"}. Swap fee ${(Number(lpFee) * 100) / Number(feeDenominator(lpFee))}%.`);
    console.log(`Issuer holds ${fmt(free)} tPOT and ${shardBal} SHARD.`);

    let tx: ReturnType<typeof api.tx.utility.batchAll>;
    let needTpot = 0n;
    if (mode === "setup") {
      if (poolThere) stop("The pool already exists. Use the swap mode, or add liquidity by hand.");
      const tpot = parseTpot14(opt("--tpot", "5"));
      const shard = BigInt(opt("--shard", "100"));
      const calls = [
        api.tx.assetConversion.createPool(NATIVE, SHARD),
        api.tx.assetConversion.addLiquidity(NATIVE, SHARD, tpot, shard, (tpot * 95n) / 100n, (shard * 95n) / 100n, issuer?.address ?? "5GNcYKPdN5Wdu31mjAJDBRUZiE7MKFHexM58o7SJDjEFxXcQ"),
      ];
      tx = api.tx.utility.batchAll(calls);
      needTpot = setupFee + tpot;
      console.log(`Setup in ONE transaction: AssetConversion.createPool(tPOT, SHARD) then addLiquidity ${fmt(tpot)} tPOT + ${shard} SHARD. Price: ${(Number(shard) / (Number(tpot) / 10 ** decimals)).toFixed(2)} SHARD per tPOT.`);
      console.log(`Needs ${fmt(needTpot)} tPOT (pool setup fee ${fmt(setupFee)} + the liquidity) plus ${shard} SHARD in the issuer wallet${shardBal >= shard ? " (it has them)" : " (it does NOT have them yet: mint SHARD to the issuer first)"}.`);
    } else {
      if (!poolThere) stop("There is no pool yet. Run the setup mode first.");
      const inTpot = opt("--in", "tpot") === "tpot";
      const amount = inTpot ? parseTpot14(opt("--amount", "0.1")) : BigInt(opt("--amount", "1"));
      const [rTpot, rShard] = await reserves(api, id);
      const [rIn, rOut] = inTpot ? [rTpot, rShard] : [rShard, rTpot];
      const quote = quoteOut(amount, rIn, rOut, lpFee, feeDenominator(lpFee));
      const floor = minOut(quote, BigInt(opt("--slippage", "5")));
      tx = api.tx.utility.batchAll([api.tx.assetConversion.swapExactTokensForTokens(inTpot ? [NATIVE, SHARD] : [SHARD, NATIVE], amount, floor, issuer?.address ?? "5GNcYKPdN5Wdu31mjAJDBRUZiE7MKFHexM58o7SJDjEFxXcQ", true)]);
      needTpot = inTpot ? amount : 0n;
      console.log(`Swap ${inTpot ? fmt(amount) + " tPOT" : amount + " SHARD"} for about ${inTpot ? quote + " SHARD" : fmt(quote) + " tPOT"} (at least ${inTpot ? floor + " SHARD" : fmt(floor) + " tPOT"}). Pool reserves: ${fmt(rTpot)} tPOT, ${rShard} SHARD.`);
    }
    let fee = "unknown";
    try {
      if (issuer) fee = fmt((await tx.paymentInfo(issuer)).partialFee);
    } catch (e) {
      fee = `estimate failed (${e instanceof Error ? e.message.split("\n")[0] : e})`;
    }
    console.log(`Fee about ${fee} tPOT. In total the issuer needs about ${fmt(needTpot)} tPOT plus the fee.`);

    if (!yes) {
      console.log("Dry run: nothing was sent. Add --yes to really send it.");
    } else {
      if (!issuer) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
      if (!assetThere) stop("The SHARD asset does not exist yet, so nothing was sent.");
      if (free < needTpot) stop("The issuer wallet does not hold enough tPOT. Nothing was sent.");
      const r = await new Promise<{ txHash: string; block: number }>((resolve, reject) => {
        tx.signAndSend(issuer, ({ status, dispatchError, txHash }) => {
          if (dispatchError) {
            const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
            reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
          } else if (status.isInBlock) api.rpc.chain.getHeader(status.asInBlock).then((h) => resolve({ txHash: txHash.toHex(), block: h.number.toNumber() })).catch(reject);
        }).catch(reject);
      });
      console.log(`Sent. Transaction ${r.txHash} in block ${r.block}.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  (await getApi()).disconnect().catch(() => {});
}

// Pool reserves (tPOT, SHARD) read through the runtime API; the pool account holds them.
async function reserves(api: Awaited<ReturnType<(typeof import("../lib/native"))["getApi"]>>, id: number): Promise<[bigint, bigint]> {
  const r = (await (api.call as never as { assetConversionApi: { getReserves(a: unknown, b: unknown): Promise<{ toJSON(): [string | number, string | number] | null }> } }).assetConversionApi.getReserves({ native: null }, { withId: id })).toJSON();
  if (!r) throw new Error("Could not read the pool reserves.");
  return [BigInt(r[0]), BigInt(r[1])];
}

main().then(() => process.exit(process.exitCode ?? 0));
