// Custody that is not one key: a Multisig account (2 of 3 by default) becomes the admin and then the owner of an NFT collection,
// and the server's issuer key stays only as "Issuer" (it can mint, nothing else).
// Always try it on a NEW throwaway collection first, never on the real one.
//
//   npx tsx scripts/multisig-custody.ts address                  show the multisig account and what it costs
//   npx tsx scripts/multisig-custody.ts create-test              make a throwaway collection whose admin and freezer are the multisig
//   npx tsx scripts/multisig-custody.ts handover <collection>    the multisig accepts ownership (2 signers approve), then the issuer hands it over
// Add --yes to really send. The signers come from env MULTISIG_SIGNERS (3 account addresses, comma separated; the issuer must be one),
// MULTISIG_THRESHOLD (default 2). Handover with --yes also needs MULTISIG_MNEMONIC_2 (a second signer's key). Keys are never printed.
// Without MULTISIG_SIGNERS the dry run uses the issuer plus two public test accounts, and --yes is refused.
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
const [mode, colArg] = args.filter((a) => !a.startsWith("--"));

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!mode || !["address", "create-test", "handover"].includes(mode)) stop("Usage: npx tsx scripts/multisig-custody.ts address|create-test|handover <collection> [--yes]");

async function main() {
  const { Keyring } = await import("@polkadot/keyring");
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  const { getApi } = await import("../lib/native");
  const { multisigAddress, otherSignatories, multisigDeposit } = await import("./multisig-lib");
  try {
    await cryptoWaitReady();
    const kr = new Keyring({ type: "sr25519", ss58Format: 42 });
    const mnemonic = process.env.ISSUER_MNEMONIC;
    const issuer = mnemonic ? kr.addFromUri(mnemonic.trim()) : null;
    const api = await getApi();
    const decimals = api.registry.chainDecimals[0] ?? 14;
    const fmt = (v: { toString(): string }) => (Number(v.toString()) / 10 ** decimals).toFixed(4);

    const real = !!process.env.MULTISIG_SIGNERS;
    const issuerAddr = issuer?.address ?? "5GNcYKPdN5Wdu31mjAJDBRUZiE7MKFHexM58o7SJDjEFxXcQ";
    const signers = real ? process.env.MULTISIG_SIGNERS!.split(",").map((s) => s.trim()) : [issuerAddr, kr.addFromUri("//Bob").address, kr.addFromUri("//Charlie").address];
    const threshold = Number(process.env.MULTISIG_THRESHOLD ?? 2);
    const ms = multisigAddress(signers, threshold);
    const base = BigInt(api.consts.multisig.depositBase.toString());
    const factor = BigInt(api.consts.multisig.depositFactor.toString());
    const msDeposit = multisigDeposit(base, factor, signers.length);
    console.log(`Multisig ${threshold} of ${signers.length}: ${ms}${real ? "" : "  (DRY RUN signers: the issuer and two public test accounts)"}`);
    console.log(`Each waiting approval locks ${fmt(msDeposit)} tPOT (base ${fmt(base)} + ${fmt(factor)} per signer), given back when it runs.`);
    if (!issuer) console.log("ISSUER_MNEMONIC is not set, so fees cannot be estimated.");
    if (yes && !real) stop("MULTISIG_SIGNERS is not set, so nothing was sent.");
    if (yes && !issuer) stop("ISSUER_MNEMONIC is not set, so nothing was sent.");
    if (yes && !signers.includes(issuer!.address)) stop("The issuer must be one of the signers. Nothing was sent.");

    const free = issuer ? BigInt(((await api.query.system.account(issuer.address)) as unknown as { data: { free: { toString(): string } } }).data.free.toString()) : 0n;
    const send = (tx: { signAndSend: Function }, signer: ReturnType<typeof kr.addFromUri>) =>
      new Promise<{ txHash: string; block: number }>((resolve, reject) => {
        tx.signAndSend(signer, ({ status, dispatchError, txHash }: never) => {
          const s = status as { isInBlock: boolean; asInBlock: never };
          const d = dispatchError as { isModule: boolean; asModule: never; toString(): string } | undefined;
          if (d) {
            const m = d.isModule ? api.registry.findMetaError(d.asModule) : null;
            reject(new Error(m ? `${m.section}.${m.name}` : d.toString()));
          } else if (s.isInBlock) api.rpc.chain.getHeader(s.asInBlock).then((h) => resolve({ txHash: (txHash as { toHex(): string }).toHex(), block: h.number.toNumber() })).catch(reject);
        }).catch(reject);
      });
    const feeOf = async (tx: { paymentInfo: Function }) => {
      try {
        return issuer ? fmt((await tx.paymentInfo(issuer)).partialFee) : "unknown";
      } catch (e) {
        return `estimate failed (${e instanceof Error ? e.message.split("\n")[0] : e})`;
      }
    };

    if (mode === "address") {
      console.log("Nothing to send in this mode.");
      return;
    }

    if (mode === "create-test") {
      const col = Number((await api.query.nfts.nextCollectionId()).toString());
      const config = { settings: 0, maxSupply: 5, mintSettings: { mintType: { Issuer: null }, price: null, startBlock: null, endBlock: null, defaultItemSettings: 0 } };
      const tx = api.tx.utility.batchAll([
        api.tx.nfts.create(issuerAddr, config), // the issuer owns it for now
        api.tx.nfts.setTeam(col, issuerAddr, ms, ms), // issuer role stays the server key, admin and freezer become the multisig
      ]);
      const deposit = BigInt(api.consts.nfts.collectionDeposit.toString());
      console.log(`Throwaway collection ${col} (5 items at most): owner ${issuerAddr}, Issuer ${issuerAddr}, Admin ${ms}, Freezer ${ms}.`);
      console.log(`Locks ${fmt(deposit)} tPOT collection deposit plus a fee of about ${await feeOf(tx)} tPOT. The issuer holds ${fmt(free)} tPOT.`);
      console.log(`Check afterwards: nfts.collectionRoleOf(${col}, ${ms}) should show Admin and Freezer.`);
      if (!yes) return void console.log("Dry run: nothing was sent. Add --yes to really send it.");
      if (free < deposit) stop("The issuer wallet does not hold enough tPOT. Nothing was sent.");
      const r = await send(tx, issuer!);
      console.log(`Done. Transaction ${r.txHash} in block ${r.block}. Throwaway collection ${col}.`);
      return;
    }

    // handover
    const col = Number(colArg);
    if (!Number.isInteger(col) || col < 0) stop("Usage: npx tsx scripts/multisig-custody.ts handover <collection> [--yes]");
    const colInfo = (await api.query.nfts.collection(col)) as unknown as { isSome: boolean; unwrap(): { owner: { toString(): string } } };
    if (!colInfo.isSome) stop(`Collection ${col} does not exist on the chain.`);
    if (col === Number(process.env.PORTAL_COLLECTION_ID ?? 5)) stop(`Collection ${col} is the real Portal collection. Prove this on a throwaway collection first. Nothing was done.`);
    const owner = colInfo.unwrap().owner.toString();
    console.log(`Collection ${col} is owned by ${owner}.${owner === issuerAddr ? "" : " The issuer does NOT own it, so step 3 would be refused."}`);
    if (yes && owner !== issuerAddr) stop("The issuer does not own this collection. Nothing was sent.");
    const accept = api.tx.nfts.setAcceptOwnership(col);
    const hash = accept.method.hash.toHex();
    const second = signers.find((s) => s !== issuerAddr)!;
    const weight = { refTime: 1_000_000_000, proofSize: 100_000 };
    const step1 = api.tx.multisig.approveAsMulti(threshold, otherSignatories(signers, issuerAddr), null, hash, weight);
    const step3 = api.tx.nfts.transferOwnership(col, ms);
    console.log("Steps:");
    console.log(`  1. issuer signs Multisig.approveAsMulti for "multisig accepts ownership of collection ${col}" (fee about ${await feeOf(step1)} tPOT, locks ${fmt(msDeposit)} tPOT until it runs)`);
    console.log(`  2. second signer ${second} signs Multisig.asMulti with the same call: now ${threshold} approved, the multisig account accepts ownership (needs MULTISIG_MNEMONIC_2)`);
    console.log(`  3. issuer signs Nfts.transferOwnership(${col}, multisig) (fee about ${await feeOf(step3)} tPOT)`);
    console.log(`tPOT the issuer needs: about ${fmt(msDeposit + 1_000_000_000_000n)} (the ${fmt(msDeposit)} approval lock, given back after step 2, plus fees); it holds ${fmt(free)}. Using the multisig account for NFT roles needs it funded too.`);
    console.log(`The multisig account ${ms} must hold at least the collection deposit (${fmt(api.consts.nfts.collectionDeposit)} tPOT) before step 3, since it takes over that deposit. Send it some first.`);
    console.log(`Check afterwards: nfts.collection(${col}).owner should be ${ms}.`);
    if (!yes) return void console.log("Dry run: nothing was sent. Add --yes to really send it.");
    const m2 = process.env.MULTISIG_MNEMONIC_2;
    if (!m2) stop("MULTISIG_MNEMONIC_2 is not set, so nothing was sent.");
    const signer2 = kr.addFromUri(m2.trim());
    if (signer2.address !== second) stop("MULTISIG_MNEMONIC_2 is not the second signer in MULTISIG_SIGNERS. Nothing was sent.");
    const msFree = BigInt(((await api.query.system.account(ms)) as unknown as { data: { free: { toString(): string } } }).data.free.toString());
    if (msFree < BigInt(api.consts.nfts.collectionDeposit.toString())) stop("The multisig account does not hold enough tPOT for the collection deposit. Send it some first. Nothing was sent.");
    await send(step1, issuer!);
    const pending = (await api.query.multisig.multisigs(ms, hash)) as unknown as { isSome: boolean; unwrap(): { when: { height: { toNumber(): number }; index: { toNumber(): number } } } };
    if (!pending.isSome) throw new Error("The first approval was not found on chain.");
    const when = pending.unwrap().when;
    const step2 = api.tx.multisig.asMulti(threshold, otherSignatories(signers, second), { height: when.height.toNumber(), index: when.index.toNumber() }, accept, weight);
    const r2 = await send(step2, signer2);
    console.log(`Approved and run. Transaction ${r2.txHash} in block ${r2.block}.`);
    const r3 = await send(step3, issuer!);
    console.log(`Ownership handed over. Transaction ${r3.txHash} in block ${r3.block}.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
  (await getApi()).disconnect().catch(() => {});
}
main().then(() => process.exit(process.exitCode ?? 0));
