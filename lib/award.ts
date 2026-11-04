import { rankCotd, type PortalClaim, type RecordStore } from "./records";
import { portalOfDay } from "./cotd";

export type AwardDeps = {
  store: RecordStore;
  mint: (tokenId: number, wallet: string) => Promise<{ txHash: string; block: number }>;
  ownerOf: (tokenId: number) => Promise<string | null>; // native owner account, null when not minted
  now?: () => number;
  // Optional: writes the win to the ledger contract and returns the transaction hash, or null if it did not.
  recordWinner?: (claim: PortalClaim) => Promise<string | null>;
};

export type AwardOutcome =
  | { status: "no-winner"; date: string; tokenId: number }
  | { status: "minted"; claim: PortalClaim }
  | { status: "already"; claim: PortalClaim }
  | { status: "failed"; date: string; tokenId: number; error: string };

// Writes the win to the ledger once. A ledger problem never undoes the mint: the claim just stays without a
// ledgerTx and the next run tries again. Without a recordWinner dependency (no ledger set up) nothing changes.
async function recordOnLedger(deps: AwardDeps, claim: PortalClaim): Promise<PortalClaim> {
  if (!deps.recordWinner || claim.ledgerTx) return claim;
  try {
    const ledgerTx = await deps.recordWinner(claim);
    if (!ledgerTx) return claim;
    const saved = { ...claim, ledgerTx };
    await deps.store.claimSave(saved);
    return saved;
  } catch {
    return claim;
  }
}

// After a day ends, the fastest ranked clear of that day's Portal wins the Portal itself: it is minted
// as a native Portaldot NFT to the winner's account. Safe to call again: a finished claim is left
// alone, and a mint that already landed is recognised from the chain instead of being sent twice.
export async function awardDay(deps: AwardDeps, date: string): Promise<AwardOutcome> {
  const tokenId = await portalOfDay(deps.store, date);
  const winner = rankCotd(await deps.store.cotdEntries(date)).find((e) => e.tokenId === tokenId);
  if (!winner) return { status: "no-winner", date, tokenId };

  const fresh: PortalClaim = { tokenId, wallet: winner.wallet, date, at: (deps.now ?? Date.now)(), status: "minting" };
  const lock = await deps.store.claimLock(fresh);
  let claim = lock.claim;
  if (!lock.ok && claim.status === "minted") {
    if (claim.date === date) claim = await recordOnLedger(deps, claim);
    return { status: "already", claim };
  }
  if (!lock.ok && claim.date !== date) return { status: "already", claim }; // won on another day, never re-awarded

  try {
    if (await deps.ownerOf(tokenId)) {
      claim = { ...claim, status: "minted" };
    } else {
      const { txHash, block } = await deps.mint(tokenId, claim.wallet);
      claim = { ...claim, status: "minted", txHash, block };
    }
    await deps.store.claimSave(claim);
    claim = await recordOnLedger(deps, claim);
    return { status: "minted", claim };
  } catch (e) {
    // Leave the lock in place as "minting" so the next run retries this same winner.
    return { status: "failed", date, tokenId, error: e instanceof Error ? e.message : "Mint failed." };
  }
}

// A mint that failed leaves its claim as "minting". The timer only looks at yesterday, so without this
// a failed day would never be tried again. Retries every unfinished claim from an earlier day.
export async function awardStuck(deps: AwardDeps, today: string, except?: string): Promise<AwardOutcome[]> {
  const stuck = (await deps.store.claimList()).filter((c) => c.status === "minting" && c.date < today && c.date !== except);
  const out: AwardOutcome[] = [];
  for (const c of stuck.sort((a, b) => a.date.localeCompare(b.date))) out.push(await awardDay(deps, c.date));
  return out;
}
