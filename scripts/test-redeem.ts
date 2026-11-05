// Rehearses the SHARD economy against the live chain with the test wallets. Nothing is sent without --yes.
//   npx tsx scripts/test-redeem.ts status                       balances, supply, taken Portals, who the ledger holds for a day
//   npx tsx scripts/test-redeem.ts seed <0x wallet> <amount>    issuer mints demo SHARD to a wallet (one batch, a note says it is a demo seed)
//   npx tsx scripts/test-redeem.ts award [--date 2026-11-04]    pays a made-up top three (Player A, Player B, deployer) through the real award code
//   npx tsx scripts/test-redeem.ts redeem <portal 1-500>        Player B signs, the real redeem code runs (take 100, burn, mint, traits, note)
// Keys come from .env.local (ISSUER_MNEMONIC, PLAYER_B_PRIVATE_KEY, ...) and are never printed.
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
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const [cmd, a1, a2] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--date");

const keyOf = (name: string) => {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set.`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
};

async function main() {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { getApi } = await import("../lib/native");
  const chain = await import("../lib/shardChain");
  const A = privateKeyToAccount(keyOf("PLAYER_A_PRIVATE_KEY")).address;
  const B = privateKeyToAccount(keyOf("PLAYER_B_PRIVATE_KEY")).address;
  const D = privateKeyToAccount(keyOf("DEPLOYER_PRIVATE_KEY")).address;
  const api = await getApi();

  if (cmd === "status") {
    console.log("issuer", await chain.issuerAddress());
    for (const [n, w] of [["A", A], ["B", B], ["deployer", D]] as const) console.log(`SHARD ${n} ${w}:`, await chain.shardBalanceOf(w));
    console.log("supply", await chain.shardSupply());
    console.log("minted Portals", (await chain.mintedPortalIds()).join(","));
    for (const d of ["2026-11-04", "2026-11-05"]) console.log(`ledger winner ${d}:`, await chain.ledgerWinnerOf(d).catch((e) => `error ${e.message}`));
  } else if (cmd === "seed") {
    const { awardBatch } = await import("../lib/shardBatch");
    const { recipientAccount } = await import("../lib/native");
    const { shardAssetId } = await import("../lib/shardToken");
    const amount = BigInt(a2 ?? "0");
    if (!a1 || amount <= 0n) throw new Error("Usage: seed <0x wallet> <amount>");
    const tx = awardBatch(api as never, { assetId: shardAssetId(), payouts: [{ account: recipientAccount(a1), amount, note: `portalsweeper:demo-seed:${amount}` }] });
    console.log(`Seed: mint ${amount} SHARD to ${a1} (one batch with a note)`);
    if (!yes) return console.log("Dry run. Add --yes to send.");
    const r = await chain.sendIssuerTx(tx as never);
    console.log("sent", r);
  } else if (cmd === "award") {
    const date = opt("--date", "2026-11-04");
    const { moveLogHash } = await import("../lib/winProof");
    const fp = (n: number) => moveLogHash([{ action: "reveal", idx: n, t: n }]);
    const rows = [
      { place: 1, wallet: B, amount: 10, seconds: 20, fingerprint: fp(1) },
      { place: 2, wallet: A, amount: 4, seconds: 25, fingerprint: fp(2) },
      { place: 3, wallet: D, amount: 2, seconds: 30, fingerprint: fp(3) },
    ];
    console.log(`Award rehearsal for test date ${date}:`, rows.map((r) => `#${r.place} ${r.wallet} ${r.amount}`).join(" | "));
    if (!yes) return console.log("Dry run. Add --yes to send.");
    const before = await Promise.all([B, A, D].map((w) => chain.shardBalanceOf(w)));
    const r = await chain.sendAward({ date, rows, portal: null });
    const after = await Promise.all([B, A, D].map((w) => chain.shardBalanceOf(w)));
    console.log("sent", r, "balances B,A,deployer before", before, "after", after);
  } else if (cmd === "redeem") {
    const portal = Number(a1);
    const { redeem, redeemMessage } = await import("../lib/redeem");
    const { getKv } = await import("../lib/shardKv");
    const acct = privateKeyToAccount(keyOf("PLAYER_B_PRIVATE_KEY"));
    const issuedAt = Date.now();
    const signature = await acct.signMessage({ message: redeemMessage(portal, issuedAt) });
    console.log(`Player B ${acct.address} signs: ${redeemMessage(portal, issuedAt)}`);
    console.log("B SHARD before:", await chain.shardBalanceOf(acct.address), "supply before:", await chain.shardSupply());
    if (!yes) return console.log("Dry run. Add --yes to run the real redeem.");
    const out = await redeem({ kv: getKv(), portalOwner: chain.portalOwnerOf, shardBalance: chain.shardBalanceOf, send: chain.sendRedeem }, { address: acct.address, signature, portal, issuedAt });
    console.log("redeem result:", JSON.stringify(out));
    console.log("B SHARD after:", await chain.shardBalanceOf(acct.address), "supply after:", await chain.shardSupply());
    console.log("owner of Portal", portal, "=", await chain.portalOwnerOf(portal));
  } else {
    console.log("Usage: status | seed <wallet> <amount> | award | redeem <portal>   (add --yes to send)");
  }
  api.disconnect().catch(() => {});
}
main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
