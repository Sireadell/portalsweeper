import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); }
async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady, mnemonicGenerate } = await import("@polkadot/util-crypto");
  const { getApi } = await import("../lib/native");
  await cryptoWaitReady();
  const kr = new Keyring({ type: "sr25519", ss58Format: 42 });
  const issuer = kr.addFromUri(process.env.ISSUER_MNEMONIC!.trim());
  const api = await getApi();
  const user = kr.addFromUri(mnemonicGenerate());
  const dec = BigInt(api.registry.chainDecimals[0]);
  const { quoteShardFee } = await import("../lib/shardFee");
  console.log("quote", await quoteShardFee(api, user.address));
  const send = (tx: any, signer: any, opts: any = {}) => new Promise<any>((res, rej) => tx.signAndSend(signer, opts, (r: any) => { if (r.dispatchError) rej(new Error(r.dispatchError.toString())); else if (r.status.isFinalized) res(r); }).catch(rej));
  const bal = async (a: string) => ({ tpot: (await api.query.system.account(a) as any).data.free.toBigInt().toString(), shard: ((await api.query.assets.account(5555, a)) as any).unwrapOr(null)?.balance?.toString() ?? "0" });
  await send(api.tx.utility.batchAll([api.tx.balances.transferKeepAlive(user.address, 1n * 10n ** dec), api.tx.assets.transfer(5555, user.address, 2)]), issuer);
  console.log("funded", await bal(user.address));
  const before = await bal(user.address);
  try {
    const r = await send(api.tx.system.remark("fee paid in SHARD test"), user, { assetId: { WithId: 5555 } as any });
    console.log("remark with assetId 5555 OK block", r.status.asFinalized.toString());
  } catch (e: any) { console.log("assetId 5555 failed:", e.message); try { const r = await send(api.tx.system.remark("fee paid in SHARD test"), user, { assetId: { WithId: 5555 } as any, tip: 0 }); console.log("alt ok", r.status.asFinalized.toString()); } catch (e2: any) { console.log("alt failed:", e2.message); } }
  console.log("before", before, "after", await bal(user.address));
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
