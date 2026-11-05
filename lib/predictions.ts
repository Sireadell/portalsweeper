// Backing a player. A head-to-head race can have a pool: people put testnet tPOT on the competitor they
// think will win, and backers of the winner split the whole pot in proportion to what they put in.
// Testnet play coins with no value. Trusted pool held by the game server (the escrow wallet).
//
// The money moves like this and no new contract is involved:
//   1. The race creator opens an event with a signed message (openEvent). The event id is the race id.
//   2. A backer sends a plain tPOT transfer to the escrow wallet, then passes the hash (backEvent). The server
//      reads that transfer from the chain before it counts.
//   3. Backing closes at the first move of the race. Competitors cannot back.
//   4. When the race is settled, resolveEvent pays the winners' backers in ONE chain batch with a note, or
//      refunds everyone on a draw, a cancel, a no show, one side only, or when nothing settles within 24 hours.
import { recoverMessageAddress, type Hex } from "viem";
import { challengeOutcome, isChallengeId } from "./challenge";
import type { RecordStore } from "./records";
import { eventOpenMessage } from "./predictMessage";
import { formatTpot, isWallet, parseTpot } from "./stakes";
import { WEI_PER_NATIVE, poolNote, poolPayNote, type PoolChain, type Payment } from "./poolPayout";
import { redisUrlCommand } from "./redisUrl";

export const BACK_MAX_WEI = 5n * 10n ** 17n; // 0.5 tPOT per backer
export const BACK_MIN_WEI = 10n ** 16n; // 0.01 tPOT, so a payout is never rounded to nothing
export const MAX_BACKERS = 20;
export const REFUND_AFTER_MS = 24 * 3_600_000;
export const HOUSE_CUT_BPS_PLANNED = 500; // 5%, shown as planned
export const HOUSE_CUT_BPS_NOW = 0; // nothing is kept unless POOL_CUT_BPS is set
export const MAX_CUT_BPS = 1000; // a typo in the setting can never take more than 10%
export const POOL_LABEL = "Testnet play coins with no value. Trusted pool held by the game server.";

export type Side = "creator" | "opponent";
export const isSide = (x: unknown): x is Side => x === "creator" || x === "opponent";

export type Back = {
  wallet: string; // lowercase 0x
  side: Side;
  amountWei: string;
  txHash: string;
  at: number;
  // Set when the transfer is real but cannot join the pool (a competitor, too late, over the cap). It is sent back.
  refundOnly?: string;
};

export type EventStatus = "open" | "locked" | "settled" | "refunded";
export type PoolEvent = {
  id: string; // the race id
  creator: string;
  createdAt: number;
  backs: Back[];
  status: EventStatus;
  winner?: string | null;
  winnerSide?: Side;
  reason?: string; // plain words for why it ended the way it did
  payoutTx?: string;
  payoutBlock?: number;
  payoutMode?: "batch" | "single";
  payoutTxs?: string[]; // set when payouts went one by one
  settledAt?: number;
  // The cut in basis points (500 = 5%), fixed when backing opens so what a backer was told is what is applied.
  cutBps?: number;
  cutWei?: string; // what the cut came to when the pool paid out (absent on refunds)
  cutTo?: string; // the treasury wallet that got it
  payoutNote?: string; // the exact note written on the chain with the payout
};

// What the race looks like from the pool's point of view.
export type RaceFacts = {
  exists: boolean;
  creator: string;
  opponent: string | null;
  started: boolean; // someone has taken a seat and begun: backing is closed
  settled: boolean;
  winner: string | null;
  cancelled: boolean;
};

export async function raceFacts(store: RecordStore, id: string, now: number): Promise<RaceFacts> {
  const ch = await store.challengeGet(id);
  if (!ch) return { exists: false, creator: "", opponent: null, started: false, settled: false, winner: null, cancelled: false };
  const entries = await store.challengeEntries(id);
  const out = challengeOutcome(ch, entries, now);
  return {
    exists: true,
    creator: ch.creator.toLowerCase(),
    opponent: entries.opponent?.wallet.toLowerCase() ?? null,
    started: !!(entries.creator || entries.opponent),
    settled: out.settled,
    winner: out.winner ? out.winner.toLowerCase() : null,
    cancelled: !!ch.cancelledAt,
  };
}

export interface PoolStore {
  get(id: string): Promise<PoolEvent | null>;
  create(rec: PoolEvent): Promise<boolean>;
  save(rec: PoolEvent): Promise<void>;
  claimTx(key: string, id: string): Promise<boolean>;
  releaseTx(key: string): Promise<void>;
  listLive(): Promise<string[]>;
  listAll(): Promise<PoolEvent[]>;
}

export type PoolDeps = {
  store: PoolStore;
  chain: PoolChain;
  races: RecordStore;
  now?: () => number;
  recover?: (message: string, signature: string) => Promise<string>;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;
const nowOf = (d: PoolDeps) => (d.now ?? Date.now)();
const recoverDefault = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });

export class PoolError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---- pure money maths ----

export const counted = (r: PoolEvent): Back[] => r.backs.filter((b) => !b.refundOnly);
export const sideTotal = (r: PoolEvent, side: Side): bigint => counted(r).filter((b) => b.side === side).reduce((s, b) => s + BigInt(b.amountWei), 0n);
export const potOf = (r: PoolEvent): bigint => sideTotal(r, "creator") + sideTotal(r, "opponent");

// The cut setting. Anything that is not a whole number from 0 to 1000 means no cut at all.
export function poolCutBps(raw: string | undefined = process.env.POOL_CUT_BPS): number {
  if (!raw || !/^\d{1,4}$/.test(raw.trim())) return 0;
  const n = Number(raw.trim());
  return n > MAX_CUT_BPS ? 0 : n;
}

// Where the cut goes: TREASURY_ADDRESS if it is a real wallet, otherwise the escrow wallet itself.
export function treasuryAddress(escrow: string, raw: string | undefined = process.env.TREASURY_ADDRESS): string {
  const t = raw?.trim();
  return t && isWallet(t) ? t.toLowerCase() : escrow.toLowerCase();
}

// The cut of a pot, rounded DOWN to a whole chain unit (the chain cannot send less), so it is exact and can
// never be more than bps of the pot. Zero when the cut is off or too small to send.
export function cutOf(potWei: bigint, bps: number): bigint {
  if (bps <= 0 || potWei <= 0n) return 0n;
  const raw = (potWei * BigInt(bps)) / 10_000n;
  return (raw / WEI_PER_NATIVE) * WEI_PER_NATIVE;
}

// Winners share the pot minus the cut in proportion to what each put in. The few wei that rounding leaves
// over stay in the escrow wallet, so winners plus cut never come to more than the pot.
export function splitPot(winners: { wallet: string; amountWei: bigint }[], potWei: bigint, houseBps = HOUSE_CUT_BPS_NOW): Payment[] {
  const total = winners.reduce((s, w) => s + w.amountWei, 0n);
  if (total <= 0n) return [];
  const distributable = potWei - cutOf(potWei, houseBps);
  return winners.map((w) => ({ to: w.wallet, wei: (distributable * w.amountWei) / total }));
}

// ---- open ----

export async function openEvent(deps: PoolDeps, input: { id: unknown; address: unknown; signature: unknown }): Promise<PoolEvent> {
  if (!isChallengeId(input.id)) throw new PoolError(404, "That race does not exist.");
  const id = input.id;
  const facts = await raceFacts(deps.races, id, nowOf(deps));
  if (!facts.exists) throw new PoolError(404, "That race does not exist.");
  if (typeof input.address !== "string" || typeof input.signature !== "string" || !isWallet(input.address)) throw new PoolError(400, "Connect your wallet and sign to open backing.");
  let who: string;
  try {
    who = (await (deps.recover ?? recoverDefault)(eventOpenMessage(id), input.signature)).toLowerCase();
  } catch {
    throw new PoolError(401, "Could not read that signature.");
  }
  if (who !== input.address.toLowerCase()) throw new PoolError(401, "That signature does not match your wallet.");
  if (who !== facts.creator) throw new PoolError(403, "Only the person who made the race can open backing on it.");
  const existing = await deps.store.get(id);
  if (existing) return existing;
  if (facts.started || facts.settled) throw new PoolError(409, "This race has already started, so backing cannot open.");
  const rec: PoolEvent = { id, creator: facts.creator, createdAt: nowOf(deps), backs: [], status: "open", cutBps: poolCutBps() };
  if (!(await deps.store.create(rec))) return (await deps.store.get(id)) ?? rec;
  return rec;
}

// ---- back ----

export async function backEvent(deps: PoolDeps, input: { id: unknown; wallet: unknown; side: unknown; txHash: unknown }): Promise<{ rec: PoolEvent; back: Back }> {
  if (!isChallengeId(input.id)) throw new PoolError(404, "That event does not exist.");
  if (!isWallet(input.wallet)) throw new PoolError(400, "Not an 0x address.");
  if (!isSide(input.side)) throw new PoolError(400, "Pick which competitor you back.");
  if (typeof input.txHash !== "string" || !HASH.test(input.txHash)) throw new PoolError(400, "Not a transaction hash.");
  const id = input.id;
  const wallet = input.wallet.toLowerCase();
  const side = input.side;
  const tx = input.txHash.toLowerCase();
  const rec = await deps.store.get(id);
  if (!rec) throw new PoolError(404, "Nobody has opened backing on this race.");
  const already = rec.backs.find((b) => b.wallet === wallet);
  if (already) return { rec, back: already }; // safe to call again
  if (rec.status === "settled" || rec.status === "refunded") throw new PoolError(409, "This event is over.");

  const t = await deps.chain.getTransfer(tx);
  if (!t) throw new PoolError(404, "Transaction not found yet. Wait a few seconds and try again.");
  if (!t.ok) throw new PoolError(400, "That transaction failed on chain.");
  if (t.from.toLowerCase() !== wallet) throw new PoolError(400, "That transfer came from a different wallet.");
  if (t.to.toLowerCase() !== deps.chain.escrowAddress().toLowerCase()) throw new PoolError(400, "That transfer did not go to the pool wallet.");
  if (t.valueWei <= 0n) throw new PoolError(400, "That transfer carried no tPOT.");
  if (!(await deps.store.claimTx(`pooltx:${tx}`, id))) throw new PoolError(409, "That transfer already backs a player.");

  // The transfer is real, so it is never kept silently: if it cannot join the pool it is marked and sent back.
  const facts = await raceFacts(deps.races, id, nowOf(deps));
  let refundOnly: string | undefined;
  if (rec.status !== "open" || facts.started || facts.settled || facts.cancelled) refundOnly = "Backing had already closed, so this is sent back.";
  else if (wallet === facts.creator || wallet === facts.opponent) refundOnly = "Competitors cannot back, so this is sent back.";
  else if (t.valueWei < BACK_MIN_WEI) refundOnly = `Less than the ${formatTpot(BACK_MIN_WEI)} tPOT minimum, so this is sent back.`;
  else if (t.valueWei > BACK_MAX_WEI) refundOnly = `More than the ${formatTpot(BACK_MAX_WEI)} tPOT cap, so this is sent back.`;
  else if (counted(rec).length >= MAX_BACKERS) refundOnly = `The pool already has ${MAX_BACKERS} backers, so this is sent back.`;

  const fresh = await deps.store.get(id);
  if (!fresh) {
    await deps.store.releaseTx(`pooltx:${tx}`);
    throw new PoolError(404, "Nobody has opened backing on this race.");
  }
  if (fresh.backs.some((b) => b.wallet === wallet)) return { rec: fresh, back: fresh.backs.find((b) => b.wallet === wallet)! };
  const back: Back = { wallet, side, amountWei: t.valueWei.toString(), txHash: tx, at: nowOf(deps), ...(refundOnly ? { refundOnly } : {}) };
  const next: PoolEvent = { ...fresh, backs: [...fresh.backs, back] };
  await deps.store.save(next);
  return { rec: next, back };
}

// ---- resolve: lock, pay or refund ----

function decide(rec: PoolEvent, facts: RaceFacts, now: number): { kind: "wait" } | { kind: "refund"; reason: string } | { kind: "pay"; winner: string; side: Side } {
  const old = now - rec.createdAt >= REFUND_AFTER_MS;
  if (!facts.exists) return old ? { kind: "refund", reason: "The race is gone, so everyone is paid back." } : { kind: "wait" };
  if (!facts.settled) return old ? { kind: "refund", reason: "The race did not finish within 24 hours, so everyone is paid back." } : { kind: "wait" };
  if (facts.cancelled) return { kind: "refund", reason: "The race was cancelled, so everyone is paid back." };
  if (!facts.winner) return { kind: "refund", reason: "Nobody won the race (a draw or a no show), so everyone is paid back." };
  const side: Side = facts.winner === facts.creator ? "creator" : "opponent";
  // A competitor who backed before taking a seat cannot be in the pool.
  const eligible = counted(rec).filter((b) => b.wallet !== facts.creator && b.wallet !== facts.opponent);
  const win = eligible.filter((b) => b.side === side);
  const lose = eligible.filter((b) => b.side !== side);
  if (!win.length || !lose.length) return { kind: "refund", reason: "Only one side was backed, so everyone is paid back." };
  return { kind: "pay", winner: facts.winner, side };
}

// Moves an event along: closes backing at the first move, then pays or refunds once the race is settled.
// Safe to call on every read and from the timer: a finished event is just returned, and a claim on the event
// id lets only one caller send money.
export async function resolveEvent(deps: PoolDeps, id: string): Promise<PoolEvent | null> {
  const rec = await deps.store.get(id);
  if (!rec) return null;
  if (rec.status === "settled" || rec.status === "refunded") return rec;
  const now = nowOf(deps);
  const facts = await raceFacts(deps.races, id, now);
  const d = decide(rec, facts, now);
  if (d.kind === "wait") {
    if (rec.status === "open" && facts.started) {
      const locked: PoolEvent = { ...rec, status: "locked" };
      await deps.store.save(locked);
      return locked;
    }
    return rec;
  }

  const claim = `resolve:${id}`;
  if (!(await deps.store.claimTx(claim, id))) return rec; // another call is paying right now
  try {
    const eligible = counted(rec).filter((b) => b.wallet !== facts.creator && b.wallet !== facts.opponent);
    const backRefunds: Payment[] = rec.backs.filter((b) => b.refundOnly || !eligible.includes(b)).map((b) => ({ to: b.wallet, wei: BigInt(b.amountWei) }));
    let payments: Payment[];
    let note: string;
    let cut = 0n;
    let cutTo: string | undefined;
    if (d.kind === "pay") {
      const winners = eligible.filter((b) => b.side === d.side).map((b) => ({ wallet: b.wallet, amountWei: BigInt(b.amountWei) }));
      const pot = eligible.reduce((s, b) => s + BigInt(b.amountWei), 0n);
      const bps = rec.cutBps ?? 0;
      const shares = splitPot(winners, pot, bps);
      cut = cutOf(pot, bps);
      const escrow = deps.chain.escrowAddress().toLowerCase();
      const treasury = treasuryAddress(escrow);
      cutTo = treasury;
      // A cut that stays in the escrow wallet needs no transfer. Refunds never carry a cut.
      const toTreasury: Payment[] = cut > 0n && treasury !== escrow ? [{ to: treasury, wei: cut }] : [];
      payments = [...shares, ...toTreasury, ...backRefunds];
      note = cut > 0n ? poolPayNote(id, d.winner, { potWei: pot, cutWei: cut, cutBps: bps, treasury, shares }) : poolNote(id, d.winner);
    } else {
      payments = rec.backs.map((b) => ({ to: b.wallet, wei: BigInt(b.amountWei) }));
      note = poolNote(id, "refund");
    }
    const base: PoolEvent = { ...rec, settledAt: now };
    let sentTx: string;
    let sentBlock: number | undefined;
    let mode: "batch" | "single" = "batch";
    let all: string[] | undefined;
    if (!payments.length) {
      sentTx = "";
    } else {
      try {
        const r = await deps.chain.payBatch(payments, note);
        sentTx = r.txHash;
        sentBlock = r.block;
      } catch (e) {
        if (!(e instanceof Error) || !/refused/i.test(e.message)) throw e;
        mode = "single"; // the node refused the batch before anything was sent: pay one by one
        const rs = await deps.chain.payEach(payments);
        all = rs.map((r) => r.txHash);
        sentTx = all[0] ?? "";
        sentBlock = rs[0]?.block;
      }
    }
    const next: PoolEvent =
      d.kind === "pay"
        ? { ...base, status: "settled", winner: d.winner, winnerSide: d.side, payoutTx: sentTx, payoutBlock: sentBlock, payoutMode: mode, ...(all ? { payoutTxs: all } : {}), ...(cut > 0n ? { payoutNote: note, cutWei: cut.toString(), cutTo } : {}), reason: cut > 0n ? "Backers of the winner shared the pot after the cut." : "Backers of the winner shared the pot." }
        : { ...base, status: "refunded", winner: facts.winner, payoutTx: sentTx, payoutBlock: sentBlock, payoutMode: mode, ...(all ? { payoutTxs: all } : {}), reason: d.reason };
    await deps.store.save(next);
    return next;
  } catch (e) {
    // A refused or failed send leaves no payout behind, so let the next call (or the timer) try again.
    // An unknown outcome (the transaction may still land) keeps the claim so nothing is paid twice.
    if (e instanceof Error && /refused|not set|nothing/i.test(e.message)) await deps.store.releaseTx(claim);
    throw e;
  }
}

// ---- what the page may see ----

export function eventView(rec: PoolEvent, facts: RaceFacts | null, names: Map<string, string>, escrow?: string) {
  const c = sideTotal(rec, "creator");
  const o = sideTotal(rec, "opponent");
  const pot = c + o;
  const label = (w: string | null) => (w ? names.get(w) ?? `${w.slice(0, 6)}…${w.slice(-4)}` : null);
  const mult = (mine: bigint) => (mine > 0n && pot > 0n ? Number((pot * 100n) / mine) / 100 : null);
  const mk = (side: Side, wallet: string | null, total: bigint) => ({
    side,
    wallet,
    name: label(wallet),
    totalTpot: formatTpot(total),
    backers: counted(rec).filter((b) => b.side === side).length,
    payoutPerTpot: mult(total), // what 1 tPOT on this side would return if it won, at today's pool
  });
  return {
    id: rec.id,
    status: rec.status,
    label: POOL_LABEL,
    potTpot: formatTpot(pot),
    capTpot: formatTpot(BACK_MAX_WEI),
    minTpot: formatTpot(BACK_MIN_WEI),
    maxBackers: MAX_BACKERS,
    houseCutPercent: { now: (rec.cutBps ?? HOUSE_CUT_BPS_NOW) / 100, planned: HOUSE_CUT_BPS_PLANNED / 100 },
    cut: {
      percent: (rec.cutBps ?? 0) / 100,
      treasury: rec.cutBps && escrow ? treasuryAddress(escrow) : null,
      paidTpot: rec.cutWei ? formatTpot(rec.cutWei) : null,
      paidTo: rec.cutTo ?? null,
    },
    closed: rec.status !== "open",
    sides: [mk("creator", facts?.creator ?? rec.creator, c), mk("opponent", facts?.opponent ?? null, o)],
    backs: rec.backs.map((b) => ({ wallet: b.wallet, name: label(b.wallet), side: b.side, amountTpot: formatTpot(b.amountWei), txHash: b.txHash, refundOnly: b.refundOnly ?? null })),
    winner: rec.winner ?? null,
    winnerSide: rec.winnerSide ?? null,
    reason: rec.reason ?? null,
    payoutTx: rec.payoutTx || null,
    payoutBlock: rec.payoutBlock ?? null,
    payoutMode: rec.payoutMode ?? null,
    payoutTxs: rec.payoutTxs ?? [],
    note: rec.status === "settled" ? rec.payoutNote ?? poolNote(rec.id, rec.winner ?? "refund") : rec.status === "refunded" ? poolNote(rec.id, "refund") : null,
    expiresAt: rec.createdAt + REFUND_AFTER_MS,
    escrow: escrow ?? null,
  };
}

export { parseTpot };

// ---- stores ----

export class MemoryPoolStore implements PoolStore {
  recs = new Map<string, PoolEvent>();
  keys = new Map<string, string>();
  async get(id: string) {
    const r = this.recs.get(id);
    return r ? { ...r, backs: [...r.backs] } : null;
  }
  async create(rec: PoolEvent) {
    if (this.recs.has(rec.id)) return false;
    this.recs.set(rec.id, rec);
    return true;
  }
  async save(rec: PoolEvent) {
    this.recs.set(rec.id, rec);
  }
  async claimTx(key: string, id: string) {
    if (this.keys.has(key)) return false;
    this.keys.set(key, id);
    return true;
  }
  async releaseTx(key: string) {
    this.keys.delete(key);
  }
  async listLive() {
    return [...this.recs.values()].filter((r) => r.status === "open" || r.status === "locked").map((r) => r.id);
  }
  async listAll() {
    return [...this.recs.values()];
  }
}

export class RedisPoolStore implements PoolStore {
  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    if (process.env.REDIS_URL) return redisUrlCommand<T>(process.env.REDIS_URL, args);
    const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "").replace(/\/+$/, "");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
    return (body.result ?? null) as T;
  }
  async get(id: string) {
    const raw = await this.cmd<string | null>("GET", `pool:${id}`);
    return raw ? (JSON.parse(raw) as PoolEvent) : null;
  }
  async create(rec: PoolEvent) {
    const made = (await this.cmd("SET", `pool:${rec.id}`, JSON.stringify(rec), "NX")) === "OK";
    if (made) await this.cmd("SADD", "pools:live", rec.id);
    return made;
  }
  async save(rec: PoolEvent) {
    await this.cmd("SET", `pool:${rec.id}`, JSON.stringify(rec));
    if (rec.status === "settled" || rec.status === "refunded") await this.cmd("SREM", "pools:live", rec.id);
  }
  async claimTx(key: string, id: string) {
    return (await this.cmd("SET", `poolkey:${key}`, id, "NX")) === "OK";
  }
  async releaseTx(key: string) {
    await this.cmd("DEL", `poolkey:${key}`);
  }
  async listLive() {
    return (await this.cmd<string[] | null>("SMEMBERS", "pools:live")) ?? [];
  }
  // Every pool record, found by walking the keys. Used only by the read-only money page.
  async listAll() {
    const out: PoolEvent[] = [];
    let cursor = "0";
    do {
      const r = await this.cmd<[string, string[]]>("SCAN", cursor, "MATCH", "pool:*", "COUNT", 200);
      cursor = String(r[0]);
      for (const k of r[1]) {
        const raw = await this.cmd<string | null>("GET", k);
        if (raw) out.push(JSON.parse(raw) as PoolEvent);
      }
    } while (cursor !== "0");
    return out;
  }
}

let memory: MemoryPoolStore | undefined;
export function getPoolStore(): PoolStore {
  const hosted =
    process.env.REDIS_URL ||
    ((process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN));
  return hosted ? new RedisPoolStore() : (memory ??= new MemoryPoolStore());
}
