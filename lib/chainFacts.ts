import { getApi } from "./native";
import { ledgerAddress, publicClient } from "./ledger";
import { readCommits } from "./commits";
import { PORTAL_COLLECTION_ID, PORTAL_SUPPLY } from "./types";

export type Fact = { key: string; label: string; state: "live" | "waiting"; value: string; how: string };

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}

// What the game uses on Portaldot right now, each read straight from the chain. Anything not switched on yet says so.
export async function chainFacts(): Promise<{ at: number; head: number | null; facts: Fact[] }> {
  const api = await safe(() => getApi());
  const pub = publicClient();
  const head = api ? await safe(async () => (await api.rpc.chain.getHeader()).number.toNumber()) : null;

  const minted = api && PORTAL_COLLECTION_ID >= 0 ? await safe(async () => (await api.query.nfts.item.entries(PORTAL_COLLECTION_ID)).length) : null;
  const names = api ? await safe(async () => (await api.query.identity.identityOf.keys()).length) : null;
  const epoch = api ? await safe(async () => (await api.query.babe.epochIndex()).toString()) : null;
  const ledger = ledgerAddress();
  const ledgerCode = ledger ? await safe(async () => ((await pub.getCode({ address: ledger }))?.length ?? 2) / 2 - 1) : null;
  const ledgerEntries = ledger && ledgerCode ? await safe(async () => (await readCommits()).filter((c) => c.kind === "ledger").length) : null;
  const shardId = process.env.SHARD_ASSET_ID;

  const facts: Fact[] = [
    {
      key: "nfts",
      label: "The 500 Portals are real NFTs on Portaldot",
      state: minted !== null ? "live" : "waiting",
      value: minted !== null ? `Collection ${PORTAL_COLLECTION_ID} on the chain. ${minted} of ${PORTAL_SUPPLY} minted so far.` : "Could not read the collection just now.",
      how: `Open the chain explorer and look up nfts, collection ${PORTAL_COLLECTION_ID}.`,
    },
    {
      key: "fingerprint",
      label: "Each day's fingerprint is posted before play",
      state: "live",
      value: ledger && ledgerCode
        ? `The DailyLedger contract at ${ledger} is deployed and live (${ledgerCode} bytes of code on chain). Each day's fingerprint is written to it when that day's Portal is awarded. ${ledgerEntries ? `${ledgerEntries} entries so far.` : "No entries yet."}`
        : "Posted as a plain note from the game wallet. The ledger contract is not switched on yet.",
      how: "Open /verify, pick a Portal and a finished day, and your browser rebuilds the board and compares.",
    },
    {
      key: "ledger",
      label: "A public ledger contract checks the secret",
      state: ledger && ledgerCode ? "live" : "waiting",
      value: ledger && ledgerCode ? `Contract ${ledger}. Anyone can send it a day's secret and it refuses a wrong one.` : "Written, tested and open source in the repo. Not deployed yet.",
      how: "Read contracts/DailyLedger.sol in the repo. It is MIT licensed.",
    },
    {
      key: "random",
      label: "The chain's own random number mixes into the board",
      state: process.env.RANDOM_FROM ? "live" : "waiting",
      value: process.env.RANDOM_FROM ? `On from ${process.env.RANDOM_FROM}. Current chain hour (epoch) ${epoch ?? "unknown"}.` : "Built and tested against the live chain. Not switched on yet.",
      how: "Each day's number and the block it was read from are shown on /verify.",
    },
    {
      key: "names",
      label: "Players can show a Portaldot identity name",
      state: names !== null ? "live" : "waiting",
      value: names !== null ? `Reads the identity pallet. ${names} names are set on the chain today.` : "Could not read names just now.",
      how: "The game can read names that wallets have set on Portaldot. They are not shown on the Hall yet.",
    },
    {
      key: "shard",
      label: "A Shard token for the daily winner",
      state: shardId ? "live" : "waiting",
      value: shardId ? `Asset ${shardId} on the chain's Assets pallet, readable as a normal token.` : "Planned. Needs a small deposit of test coins to create.",
      how: "Look up the asset in the chain explorer.",
    },
  ];
  return { at: Date.now(), head, facts };
}
