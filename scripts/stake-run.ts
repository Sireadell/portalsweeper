// One real stake run on Portaldot V3: lock, payout and refund, with real transfers between our test wallets.
// Look first (sends nothing):  npx tsx scripts/stake-run.ts
// Really run:                  npx tsx scripts/stake-run.ts --yes
// Keys come from chain/.env.local (DEPLOYER_PRIVATE_KEY, ESCROW_PRIVATE_KEY, PLAYER_A_PRIVATE_KEY, PLAYER_B_PRIVATE_KEY). They are never printed.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const yes = process.argv.includes("--yes");
const STAKE = "0.01";
const mArg = process.argv.find((x) => x.startsWith("--matches="));
const MATCHES = mArg ? Math.max(2, Number(mArg.split("=")[1])) : 8; // half pay out, half end in a draw and refund
const ESCROW_TOPUP = parseEther("0.5"); // gas for payouts
const PLAYER_TOPUP = parseEther("0.1"); // stake plus gas

function key(name: string) {
  const k = process.env[name];
  if (!k) {
    console.error(`${name} is not set in chain/.env.local, so nothing was sent.`);
    process.exit(1);
  }
  return privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex);
}

async function main() {
  const { portaldot } = await import("../lib/portaldot");
  const { MemoryStakeStore, createStake, lockStake, settleStake, refundStake, parseTpot } = await import("../lib/stakes");
  const { portaldotStakeChain } = await import("../lib/stakeChain");

  const deployer = key("DEPLOYER_PRIVATE_KEY");
  const escrow = key("ESCROW_PRIVATE_KEY");
  const a = key("PLAYER_A_PRIVATE_KEY");
  const b = key("PLAYER_B_PRIVATE_KEY");
  const pub = createPublicClient({ chain: portaldot, transport: http() });
  const wallet = (account: ReturnType<typeof key>) => createWalletClient({ account, chain: portaldot, transport: http() });
  const bal = async (addr: Hex) => formatEther(await pub.getBalance({ address: addr }));

  console.log("Balances now (tPOT):");
  for (const [n, x] of [["deployer", deployer], ["escrow", escrow], ["player A", a], ["player B", b]] as const) console.log(`  ${n} ${x.address}  ${await bal(x.address)}`);
  console.log(`Plan: top up any wallet that is low from the deployer, then ${MATCHES} matches of ${STAKE} tPOT each.`);
  console.log("  Odd matches: both lock, the winner (A and B take turns) is paid the pot by the escrow.");
  console.log("  Even matches: both lock, a draw, the escrow refunds each player.");
  console.log(`  That is about ${(MATCHES / 2) * 3 + (MATCHES / 2) * 4} real transactions.`);
  if (!yes) {
    console.log("Dry run: nothing was sent. Add --yes to run it for real.");
    return;
  }

  const send = async (from: ReturnType<typeof key>, to: Hex, value: bigint) => {
    const hash = await wallet(from).sendTransaction({ to, value });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`Transfer ${hash} failed.`);
    return { hash, block: Number(rc.blockNumber) };
  };

  const txs: { kind: string; hash: string; block: number }[] = [];
  const log = (kind: string, t: { hash: string; block: number }) => { txs.push({ kind, ...t }); return t; };
  for (const [n, x, need] of [["escrow", escrow, ESCROW_TOPUP], ["player A", a, PLAYER_TOPUP], ["player B", b, PLAYER_TOPUP]] as const) {
    if ((await pub.getBalance({ address: x.address })) < need / 2n) log(`Top up ${n}`, await send(deployer, x.address, need));
  }
  console.log("Wallets ready.");

  const deps = { store: new MemoryStakeStore(), chain: portaldotStakeChain() };
  const amount = parseTpot(STAKE);

  async function match(i: number) {
    const id = `run-${i}`;
    const draw = i % 2 === 0;
    const winner = (i >> 1) % 2 === 0 ? a : b;
    await createStake(deps, id, { creator: a.address, amountTpot: STAKE });
    log(`Match ${i}: player A locks`, await send(a, escrow.address, amount));
    await lockStake(deps, id, a.address, txs[txs.length - 1].hash);
    log(`Match ${i}: player B locks`, await send(b, escrow.address, amount));
    await lockStake(deps, id, b.address, txs[txs.length - 1].hash);
    const rec = draw ? await refundStake(deps, id) : await settleStake(deps, id, winner.address);
    const list = draw ? (rec.refundTxs ?? []).map((h, k) => ({ hash: h, block: rec.refundBlocks?.[k] ?? 0 })) : rec.payoutTx ? [{ hash: rec.payoutTx, block: rec.payoutBlock ?? 0 }] : [];
    for (const r of list) log(draw ? `Match ${i}: refund` : `Match ${i}: payout to ${winner === a ? "player A" : "player B"}`, r);
    console.log(`Match ${i} ${draw ? "refunded" : "paid out"}.`);
  }
  for (let i = 1; i <= MATCHES; i++) await match(i);

  mkdirSync(path.join(process.cwd(), "proof"), { recursive: true });
  writeFileSync(path.join(process.cwd(), "proof", "stake-matches.json"), JSON.stringify({ at: new Date().toISOString(), stakeTpot: STAKE, txs }, null, 2));
  const { blockLink } = await import("../lib/types");
  const rows = txs.map((t, n) => `| ${n + 1} | ${t.kind} | \`${t.hash}\` | [${t.block}](${blockLink(t.block)}) |`).join("\n");
  mkdirSync(path.join(process.cwd(), "docs"), { recursive: true });
  writeFileSync(path.join(process.cwd(), "docs", "stake-proof.md"), `# Real stake run on Portaldot V3

Every row is a real transfer on the Portaldot V3 testnet (tPOT has no value). Players A and B each lock ${STAKE} tPOT in the escrow wallet, then the escrow pays the winner or refunds a draw. Open a block link and find the transaction hash in it.

| # | What | Transaction hash | Block |
|---|---|---|---|
${rows}
`);
  console.log(`Done. ${txs.length} transactions. Saved proof/stake-matches.json and docs/stake-proof.md`);
  console.log("Balances after (tPOT):");
  for (const [n, x] of [["escrow", escrow], ["player A", a], ["player B", b]] as const) console.log(`  ${n}  ${await bal(x.address)}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
