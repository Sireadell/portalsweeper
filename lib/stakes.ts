// Stakes for a PvP match, on Portaldot V3 testnet. Both players send the same amount of tPOT to a
// server held escrow wallet (a plain EVM transfer, no contract). The server checks each transfer on
// chain before it counts, and when the match ends it sends the whole pot to the winner.
// tPOT has no value. Nothing here depends on the challenge code: the challenge flow calls
// createStake, lockStake, settleStake and refundStake with its own challenge id.
import { redisUrlCommand } from "./redisUrl";

export const STAKE_MAX_WEI = 10n ** 18n; // 1 tPOT cap per player

export type StakeStatus = "open" | "locked" | "settled" | "refunded";

export type StakeLock = { wallet: string; txHash: string; at: number };

export type StakeRecord = {
  challengeId: string;
  amountWei: string; // each player's stake, in wei (18 decimals)
  creator: string; // lowercase 0x wallet of the player who set the terms
  opponent?: string; // lowercase 0x wallet of the second player
  locks: StakeLock[];
  status: StakeStatus;
  winner?: string;
  payoutTx?: string; // the pot going to the winner
  payoutBlock?: number;
  refundTxs?: string[];
  refundBlocks?: number[];
  createdAt: number;
  settledAt?: number;
};

export type StakeTerms = { creator: string; amountTpot: string };

// What the server reads back from chain about one transfer.
export type ChainTransfer = { from: string; to: string; valueWei: bigint; ok: boolean };

export interface StakeChain {
  escrowAddress(): string;
  getTransfer(txHash: string): Promise<ChainTransfer | null>;
  send(to: string, valueWei: bigint): Promise<{ txHash: string; block?: number }>;
  // Set when the pot sits in the escrow contract: the contract pays out, keyed by challenge id.
  settle?(challengeId: string, winner: string): Promise<{ txHash: string; block?: number }>;
  refundAll?(challengeId: string): Promise<{ txHash: string; block?: number }>;
}

export interface StakeStore {
  get(challengeId: string): Promise<StakeRecord | null>;
  create(rec: StakeRecord): Promise<boolean>; // false when the id exists
  save(rec: StakeRecord): Promise<void>;
  claimTx(txHash: string, challengeId: string): Promise<boolean>; // one transfer can back one lock only
  releaseTx(txHash: string): Promise<void>;
  listLive(): Promise<string[]>; // challenge ids whose stake is still open or locked (for the timer)
}

export type StakeDeps = { store: StakeStore; chain: StakeChain; now?: () => number };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
export const isWallet = (s: unknown): s is string => typeof s === "string" && ADDR.test(s);

export function parseTpot(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(s.trim());
  if (!m) throw new Error("Amount must be a plain number like 0.05.");
  const wei = BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
  if (wei <= 0n) throw new Error("Amount must be more than 0.");
  if (wei > STAKE_MAX_WEI) throw new Error("Testnet stakes are capped at 1 tPOT each.");
  return wei;
}

export function formatTpot(wei: bigint | string): string {
  const w = BigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const potWei = (r: StakeRecord): bigint => BigInt(r.amountWei) * BigInt(r.locks.length);

export async function createStake(deps: StakeDeps, challengeId: string, terms: StakeTerms): Promise<StakeRecord> {
  if (!challengeId) throw new Error("Missing challenge id.");
  if (!isWallet(terms.creator)) throw new Error("Not an 0x address.");
  const rec: StakeRecord = {
    challengeId,
    amountWei: parseTpot(terms.amountTpot).toString(),
    creator: terms.creator.toLowerCase(),
    locks: [],
    status: "open",
    createdAt: (deps.now ?? Date.now)(),
  };
  if (!(await deps.store.create(rec))) throw new Error("This challenge already has a stake.");
  return rec;
}

// A player has sent their stake to the escrow wallet and passes the transaction hash. It only counts
// if chain shows a successful transfer of at least the stake, from that player, to the escrow.
export async function lockStake(deps: StakeDeps, challengeId: string, player: string, txHash: string): Promise<StakeRecord> {
  if (!isWallet(player)) throw new Error("Not an 0x address.");
  if (!HASH.test(txHash)) throw new Error("Not a transaction hash.");
  const wallet = player.toLowerCase();
  const rec = await deps.store.get(challengeId);
  if (!rec) throw new Error("No stake on this challenge.");
  if (rec.status !== "open") throw new Error("This stake is no longer open.");
  if (rec.locks.some((l) => l.wallet === wallet)) return rec; // already locked, safe to call again
  if (rec.locks.length >= 2) throw new Error("Both stakes are already locked.");

  const t = await deps.chain.getTransfer(txHash);
  if (!t) throw new Error("Transaction not found yet. Wait a few seconds and try again.");
  if (!t.ok) throw new Error("That transaction failed on chain.");
  if (t.from.toLowerCase() !== wallet) throw new Error("That transfer came from a different wallet.");
  if (t.to.toLowerCase() !== deps.chain.escrowAddress().toLowerCase()) throw new Error("That transfer did not go to the escrow wallet.");
  if (t.valueWei < BigInt(rec.amountWei)) throw new Error(`Transfer is less than the ${formatTpot(rec.amountWei)} tPOT stake.`);
  const tx = txHash.toLowerCase();
  if (!(await deps.store.claimTx(tx, challengeId))) throw new Error("That transfer already backs another stake.");

  const fresh = await deps.store.get(challengeId);
  if (!fresh || fresh.status !== "open" || fresh.locks.length >= 2) {
    await deps.store.releaseTx(tx);
    throw new Error("This stake is no longer open.");
  }
  const next: StakeRecord = { ...fresh, locks: [...fresh.locks, { wallet, txHash: tx, at: (deps.now ?? Date.now)() }] };
  if (next.locks.length === 2) next.status = "locked";
  if (wallet !== next.creator) next.opponent = wallet;
  await deps.store.save(next);
  return next;
}

// The match is over. The winner must be one of the two players. Safe to call again: a payout that
// already went out is returned, not sent twice.
export async function settleStake(deps: StakeDeps, challengeId: string, winner: string): Promise<StakeRecord> {
  if (!isWallet(winner)) throw new Error("Not an 0x address.");
  const rec = await deps.store.get(challengeId);
  if (!rec) throw new Error("No stake on this challenge.");
  if (rec.status === "settled") return rec;
  if (rec.status !== "locked") throw new Error("Both players must lock their stake first.");
  const w = winner.toLowerCase();
  if (!rec.locks.some((l) => l.wallet === w)) throw new Error("The winner is not a player in this stake.");
  const sent = deps.chain.settle ? await deps.chain.settle(challengeId, w) : await deps.chain.send(w, potWei(rec));
  const next: StakeRecord = { ...rec, status: "settled", winner: w, payoutTx: sent.txHash, payoutBlock: sent.block, settledAt: (deps.now ?? Date.now)() };
  await deps.store.save(next);
  return next;
}

// A draw, a no show or a cancelled match: every locked stake goes back to the wallet it came from.
export async function refundStake(deps: StakeDeps, challengeId: string): Promise<StakeRecord> {
  const rec = await deps.store.get(challengeId);
  if (!rec) throw new Error("No stake on this challenge.");
  if (rec.status === "settled" || rec.status === "refunded") return rec;
  const txs: string[] = [];
  const blocks: number[] = [];
  if (deps.chain.refundAll) {
    const sent = await deps.chain.refundAll(challengeId);
    txs.push(sent.txHash);
    if (sent.block !== undefined) blocks.push(sent.block);
  } else {
    for (const l of rec.locks) {
      const sent = await deps.chain.send(l.wallet, BigInt(rec.amountWei));
      txs.push(sent.txHash);
      if (sent.block !== undefined) blocks.push(sent.block);
    }
  }
  const next: StakeRecord = { ...rec, status: "refunded", refundTxs: txs, refundBlocks: blocks, settledAt: (deps.now ?? Date.now)() };
  await deps.store.save(next);
  return next;
}

export async function getStake(deps: StakeDeps, challengeId: string): Promise<StakeRecord | null> {
  return deps.store.get(challengeId);
}

// ---- stores ----

export class MemoryStakeStore implements StakeStore {
  recs = new Map<string, StakeRecord>();
  txs = new Map<string, string>();
  async get(id: string) {
    const r = this.recs.get(id);
    return r ? { ...r, locks: [...r.locks] } : null;
  }
  async create(rec: StakeRecord) {
    if (this.recs.has(rec.challengeId)) return false;
    this.recs.set(rec.challengeId, rec);
    return true;
  }
  async save(rec: StakeRecord) {
    this.recs.set(rec.challengeId, rec);
  }
  async claimTx(tx: string, id: string) {
    if (this.txs.has(tx)) return false;
    this.txs.set(tx, id);
    return true;
  }
  async releaseTx(tx: string) {
    this.txs.delete(tx);
  }
  async listLive() {
    return [...this.recs.values()].filter((r) => r.status === "open" || r.status === "locked").map((r) => r.challengeId);
  }
}

// Same Redis the rest of the site uses: REDIS_URL, else Upstash REST. Without either (local dev),
// stakes live in memory for the life of the server process only.
export class RedisStakeStore implements StakeStore {
  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    if (process.env.REDIS_URL) return redisUrlCommand<T>(process.env.REDIS_URL, args);
    const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "").replace(/\/+$/, "");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
    return (body.result ?? null) as T;
  }
  async get(id: string) {
    const raw = await this.cmd<string | null>("GET", `stake:${id}`);
    return raw ? (JSON.parse(raw) as StakeRecord) : null;
  }
  async create(rec: StakeRecord) {
    const made = (await this.cmd("SET", `stake:${rec.challengeId}`, JSON.stringify(rec), "NX")) === "OK";
    if (made) await this.cmd("SADD", "stakes:live", rec.challengeId);
    return made;
  }
  async save(rec: StakeRecord) {
    await this.cmd("SET", `stake:${rec.challengeId}`, JSON.stringify(rec));
    if (rec.status === "settled" || rec.status === "refunded") await this.cmd("SREM", "stakes:live", rec.challengeId);
  }
  async listLive() {
    return (await this.cmd<string[] | null>("SMEMBERS", "stakes:live")) ?? [];
  }
  async claimTx(tx: string, id: string) {
    return (await this.cmd("SET", `staketx:${tx}`, id, "NX")) === "OK";
  }
  async releaseTx(tx: string) {
    await this.cmd("DEL", `staketx:${tx}`);
  }
}

let memory: MemoryStakeStore | undefined;
export function getStakeStore(): StakeStore {
  const hosted =
    process.env.REDIS_URL ||
    ((process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN));
  return hosted ? new RedisStakeStore() : (memory ??= new MemoryStakeStore());
}

export { stakesEnabled } from "./stakesFlag";
