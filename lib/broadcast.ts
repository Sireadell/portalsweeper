// Live broadcast: a list of games that are open to watch, a 15 second delay, and a viewer count.
// A viewer never gets a mine or a hidden number while the game runs: the answer is rebuilt from the
// move log, only up to 15 seconds ago, with every closed tile left blank.
import { createHash } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import * as G from "./game";
import { replayLog } from "./live";
import type { StoredMove } from "./records";
import type { Board } from "./types";
import { redisUrlCommand } from "./redisUrl";

export const DELAY_MS = 15_000;
export const VIEWER_WINDOW_MS = 20_000;
export const HEARTBEAT_GAP_S = 10;
export const MAX_LIVE = 50;
export const LINGER_MS = 10 * 60_000; // a broadcast stays up this long after the game ends
export const MAX_RUN_MS = 2 * 3_600_000; // a game with no end is dropped from the list after this

export const broadcastMessage = (date: string) =>
  `Portalsweeper broadcast ${date}\nI am letting anyone watch my ranked try, 15 seconds late. No fee, no transaction.`;

// ---------------------------------------------------------------------------
// A small key-value layer over the same Redis the records use (no new service)
// ---------------------------------------------------------------------------
export interface Kv {
  cmd<T = unknown>(...args: (string | number)[]): Promise<T>;
}

class UpstashKv implements Kv {
  constructor(private url: string, private token: string) {}
  async cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error("kv error");
    return body.result as T;
  }
}

class RedisUrlKv implements Kv {
  constructor(private url: string) {}
  cmd<T>(...args: (string | number)[]): Promise<T> {
    return redisUrlCommand<T>(this.url, args);
  }
}

// Used by tests and by a local run with no Redis. Supports only the commands this file sends.
export class MemoryKv implements Kv {
  private kv = new Map<string, string>();
  private exp = new Map<string, number>();
  private z = new Map<string, Map<string, number>>();
  private zset(k: string) {
    if (!this.z.has(k)) this.z.set(k, new Map());
    return this.z.get(k)!;
  }
  async cmd<T>(...a: (string | number)[]): Promise<T> {
    const [op, key, ...r] = a.map((x, i) => (i === 0 ? String(x).toUpperCase() : x)) as [string, string, ...(string | number)[]];
    if ((this.exp.get(key) ?? Infinity) <= Date.now()) { this.kv.delete(key); this.exp.delete(key); }
    const num = (x: string | number) => (String(x).toLowerCase().includes("inf") ? Infinity : Number(x));
    switch (op) {
      case "EXPIRE": return 1 as T;
      case "GET": return (this.kv.get(key) ?? null) as T;
      case "SET": {
        if (r.includes("NX") && this.kv.has(key)) return null as T;
        this.kv.set(key, String(r[0]));
        const ex = r.indexOf("EX");
        if (ex >= 0) this.exp.set(key, Date.now() + Number(r[ex + 1]) * 1000);
        return "OK" as T;
      }
      case "ZADD": this.zset(key).set(String(r[1]), Number(r[0])); return 1 as T;
      case "ZREM": return (this.zset(key).delete(String(r[0])) ? 1 : 0) as T;
      case "ZCOUNT": return [...this.zset(key).values()].filter((s) => s >= num(r[0]) && s <= num(r[1])).length as T;
      case "ZRANGE": return [...this.zset(key).entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0]) as T;
      case "ZREMRANGEBYSCORE": {
        const z = this.zset(key);
        let n = 0;
        for (const [m, s] of z) if (s >= num(r[0]) && s <= num(r[1])) { z.delete(m); n++; }
        return n as T;
      }
      default: throw new Error(`MemoryKv: ${op}`);
    }
  }
}

let kv: Kv | undefined;
export function getKv(): Kv {
  if (kv) return kv;
  if (process.env.REDIS_URL) return (kv = new RedisUrlKv(process.env.REDIS_URL));
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    return (kv = new UpstashKv(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN));
  return (kv = new MemoryKv());
}
export function setKv(k: Kv | undefined) {
  kv = k;
}

// ---------------------------------------------------------------------------
// The broadcast list
// ---------------------------------------------------------------------------
export type BroadcastKind = "ranked" | "race";
export type Broadcast = {
  code: string;
  kind: BroadcastKind;
  date: string;
  tokenId: number;
  tags: string[]; // tier, twist and the like
  startedAt: number;
  endedAt?: number;
  wallet?: string; // ranked: the lowercase player wallet
};

const recKey = (code: string) => `bc:rec:${code}`;
const LIST = "bc:list";
const rankedKey = (date: string, wallet: string) => `bc:ranked:${date}:${wallet}`;

export const isCode = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8,12}$/.test(x);

export const isLive = (b: Broadcast, now: number) => (b.endedAt ? now < b.endedAt + LINGER_MS : now < b.startedAt + MAX_RUN_MS);

export async function getBroadcast(k: Kv, code: string): Promise<Broadcast | null> {
  const raw = await k.cmd<string | null>("GET", recKey(code));
  return raw ? (JSON.parse(raw) as Broadcast) : null;
}

export async function listBroadcasts(k: Kv, now: number): Promise<Broadcast[]> {
  const codes = await k.cmd<string[]>("ZRANGE", LIST, 0, -1);
  const out: Broadcast[] = [];
  for (const code of codes) {
    const b = await getBroadcast(k, code);
    if (b && isLive(b, now)) out.push(b);
    else await k.cmd("ZREM", LIST, code); // finished and lingered out
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export type RegisterResult = { ok: true; broadcast: Broadcast } | { ok: false; status: number; error: string };

async function register(k: Kv, b: Broadcast, now: number): Promise<RegisterResult> {
  if ((await listBroadcasts(k, now)).length >= MAX_LIVE)
    return { ok: false, status: 429, error: "Too many broadcasts are running right now. Your game still counts, it is just not shown." };
  await k.cmd("SET", recKey(b.code), JSON.stringify(b));
  await k.cmd("ZADD", LIST, b.startedAt, b.code);
  return { ok: true, broadcast: b };
}

// A ranked try opts in. The code is random; the same wallet and day always gives the same broadcast back.
export async function registerRanked(
  k: Kv,
  input: { wallet: string; date: string; tokenId: number; tags: string[]; startedAt: number },
  now: number,
  newCode: () => string = () => createHash("sha256").update(`${Math.random()}:${now}`).digest("hex").slice(0, 10),
): Promise<RegisterResult> {
  const existing = await k.cmd<string | null>("GET", rankedKey(input.date, input.wallet));
  if (existing) {
    const b = await getBroadcast(k, existing);
    if (b) return { ok: true, broadcast: b };
  }
  const b: Broadcast = { code: newCode(), kind: "ranked", date: input.date, tokenId: input.tokenId, tags: input.tags, startedAt: input.startedAt, wallet: input.wallet };
  const out = await register(k, b, now);
  if (out.ok) await k.cmd("SET", rankedKey(input.date, input.wallet), b.code);
  return out;
}

// Races with a backing event are public: the event code is the race id, so the watch link is the race link.
export async function registerRace(k: Kv, input: { id: string; date: string; tokenId: number; tags: string[]; startedAt: number }, now: number): Promise<RegisterResult> {
  const have = await getBroadcast(k, input.id);
  if (have) return { ok: true, broadcast: have };
  return register(k, { code: input.id, kind: "race", date: input.date, tokenId: input.tokenId, tags: input.tags, startedAt: input.startedAt }, now);
}

export async function endBroadcast(k: Kv, code: string, at: number): Promise<void> {
  const b = await getBroadcast(k, code);
  if (!b || b.endedAt) return;
  await k.cmd("SET", recKey(code), JSON.stringify({ ...b, endedAt: at }));
}

// Called when a ranked try ends, so the broadcast starts its 10 minute countdown.
export async function endRankedBroadcast(k: Kv, date: string, wallet: string, at: number): Promise<void> {
  const code = await k.cmd<string | null>("GET", rankedKey(date, wallet));
  if (code) await endBroadcast(k, code, at);
}

// ---------------------------------------------------------------------------
// The delayed picture: what a viewer may see
// ---------------------------------------------------------------------------
export type SeatView = {
  state: "waiting" | "playing" | "won" | "lost";
  revealed: boolean[];
  flagged: boolean[];
  adj: (number | null)[]; // the number on an open tile; null while closed
  elapsed: number; // seconds on the server clock, as of the delayed moment
  opened: number; // percent of safe tiles open
  mines?: boolean[]; // only once the game is over (and 15 s late)
  hit?: number;
};

const over = (g: G.GameState) => g.status === "won" || g.status === "lost";

export const delayedLog = (log: StoredMove[], now: number, delay = DELAY_MS) => log.filter((m) => m.t <= now - delay);

export function seatView(board: Board, log: StoredMove[], now: number, delay = DELAY_MS): SeatView {
  const seen = delayedLog(log, now, delay);
  const g = replayLog(board, seen);
  const done = over(g);
  const first = seen.find((m) => m.action === "reveal");
  const end = done ? seen[seen.length - 1].t : now - delay;
  const elapsed = first ? Math.round(Math.max(0, end - first.t) / 100) / 10 : 0;
  const safe = board.cells.filter((c) => !c.mine).length || 1;
  const opened = Math.round((g.revealed.reduce((n, r, i) => n + (r && !board.cells[i].mine ? 1 : 0), 0) / safe) * 100);
  const v: SeatView = {
    state: g.status === "won" ? "won" : g.status === "lost" ? "lost" : g.started ? "playing" : "waiting",
    revealed: g.revealed.map((r, i) => r && !board.cells[i].mine),
    flagged: g.flagged,
    adj: g.revealed.map((r, i) => (r && !board.cells[i].mine ? board.cells[i].adj : null)),
    elapsed,
    opened,
  };
  if (done) {
    v.mines = board.cells.map((c) => c.mine);
    if (g.hit !== undefined) v.hit = g.hit;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Viewers: one entry per hashed address, counted if seen in the last 20 seconds
// ---------------------------------------------------------------------------
export const hashViewer = (ip: string, day: string) => createHash("sha256").update(`viewer:${day}:${ip}`).digest("hex").slice(0, 24);

const viewKey = (code: string) => `bc:v:${code}`;

export async function viewerCount(k: Kv, code: string, now: number): Promise<number> {
  return Number(await k.cmd("ZCOUNT", viewKey(code), now - VIEWER_WINDOW_MS, "+inf")) || 0;
}

// One heartbeat per hashed address per 10 seconds; a faster one is ignored (not an error).
export async function heartbeat(k: Kv, code: string, viewer: string, now: number): Promise<{ counted: boolean; viewers: number }> {
  const gate = await k.cmd("SET", `bc:hb:${code}:${viewer}`, "1", "NX", "EX", HEARTBEAT_GAP_S);
  if (gate !== "OK") return { counted: false, viewers: await viewerCount(k, code, now) };
  await k.cmd("ZADD", viewKey(code), now, viewer);
  await k.cmd("ZREMRANGEBYSCORE", viewKey(code), 0, now - VIEWER_WINDOW_MS);
  await k.cmd("EXPIRE", viewKey(code), 120);
  return { counted: true, viewers: await viewerCount(k, code, now) };
}

export const recoverBroadcast = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });
