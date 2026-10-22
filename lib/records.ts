import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redisUrlCommand } from "./redisUrl";

export type PortalRecord = {
  tokenId: number;
  plays: number;
  wins: number;
  bestSeconds: number | null;
  currentStreak: number;
  longestStreak: number;
  lastDate: string | null;
};

export type DayResult = { tokenId: number; date: string; won: boolean; seconds: number; moves: number };

export type SubmitOutcome =
  | { ok: true; record: PortalRecord }
  | { ok: false; reason: "already-played"; record: PortalRecord };

// Portal of the day: one ranked try per wallet per UTC day. startedAt is the server clock when the
// wallet pressed Start, the other fields are filled in once when the try ends.
export type CotdEntry = {
  date: string;
  wallet: string; // lowercase 0x address
  tokenId: number; // the featured Portal that day
  startedAt: number; // ms since epoch
  finishedAt?: number;
  won?: boolean;
  seconds?: number;
  moves?: number;
};

export type CotdStart = { ok: true; entry: CotdEntry } | { ok: false; entry: CotdEntry };
export type CotdFinish =
  | { ok: true; entry: CotdEntry }
  | { ok: false; reason: "not-started" | "already-finished"; entry?: CotdEntry };
export type CotdResult = { won: boolean; seconds: number; moves: number; at: number };

// One move of a live game, as the server saw it: t is the server clock in ms.
export type StoredMove = { action: "reveal" | "flag" | "chord"; idx: number; t: number };

// Wins only, fastest first. Ties go to whoever finished first.
export function rankCotd(entries: CotdEntry[]): CotdEntry[] {
  return entries
    .filter((e) => e.won === true && typeof e.seconds === "number")
    .sort((a, b) => a.seconds! - b.seconds! || (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
}

// Two stores implement this: FileRecordStore (local dev) and UpstashRecordStore (hosted).
// getStore() picks plain Redis when REDIS_URL is set, else Upstash when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
export interface RecordStore {
  getRecord(tokenId: number): Promise<PortalRecord>;
  listRecords(): Promise<PortalRecord[]>;
  submit(result: DayResult): Promise<SubmitOutcome>;
  cotdStart(entry: CotdEntry): Promise<CotdStart>;
  cotdFinish(date: string, wallet: string, r: CotdResult): Promise<CotdFinish>;
  cotdEntries(date: string): Promise<CotdEntry[]>;
  cotdEntry(date: string, wallet: string): Promise<CotdEntry | null>;
  claimLock(claim: PortalClaim): Promise<ClaimLock>;
  claimSave(claim: PortalClaim): Promise<void>;
  claimDrop(tokenId: number): Promise<void>;
  claimGet(tokenId: number): Promise<PortalClaim | null>;
  claimList(): Promise<PortalClaim[]>;
  // The Portal featured on a day is fixed the first time it is worked out, so a claim landing
  // during the day can never change which Portal is up for grabs.
  featuredGet(date: string): Promise<number | null>;
  featuredSet(date: string, tokenId: number): Promise<number>; // returns the stored value
  // The move log of a live game (a ranked try or a Portal's daily board), append only.
  movesAdd(game: string, move: StoredMove): Promise<void>;
  movesGet(game: string): Promise<StoredMove[]>;
}

// The first player to clear a Portal's board can claim that Portal as an NFT on Portaldot.
// The lock is taken before minting so only one claim per Portal can ever start.
export type PortalClaim = {
  tokenId: number;
  wallet: string; // lowercase 0x address of the winner (the NFT goes to its Portaldot account)
  date: string; // the day of the winning clear
  at: number; // ms since epoch, server clock
  status: "minting" | "minted";
  txHash?: string; // the native extrinsic hash once minted
  block?: number;
};
export type ClaimLock = { ok: true; claim: PortalClaim } | { ok: false; claim: PortalClaim };

function finishEntry(cur: CotdEntry, r: CotdResult): CotdEntry {
  return { ...cur, finishedAt: r.at, won: r.won, seconds: r.seconds, moves: r.moves };
}

export function emptyRecord(tokenId: number): PortalRecord {
  return { tokenId, plays: 0, wins: 0, bestSeconds: null, currentStreak: 0, longestStreak: 0, lastDate: null };
}

function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// Pure streak maths. A win on the day after the last win continues the streak,
// a win after a gap starts again at 1, a loss ends it.
export function applyResult(rec: PortalRecord, r: DayResult, lastWinDate: string | null): { rec: PortalRecord; lastWinDate: string | null } {
  const next: PortalRecord = { ...rec, plays: rec.plays + 1, lastDate: r.date };
  let win = lastWinDate;
  if (r.won) {
    next.wins = rec.wins + 1;
    next.bestSeconds = rec.bestSeconds === null ? r.seconds : Math.min(rec.bestSeconds, r.seconds);
    next.currentStreak = lastWinDate && dayBefore(r.date) === lastWinDate ? rec.currentStreak + 1 : 1;
    next.longestStreak = Math.max(rec.longestStreak, next.currentStreak);
    win = r.date;
  } else {
    next.currentStreak = 0;
  }
  return { rec: next, lastWinDate: win };
}

type Db = {
  records: Record<string, PortalRecord>;
  lastWin: Record<string, string>;
  days: Record<string, DayResult>;
  cotd?: Record<string, Record<string, CotdEntry>>;
  claims?: Record<string, PortalClaim>;
  featured?: Record<string, number>;
  moves?: Record<string, StoredMove[]>;
};

export class FileRecordStore implements RecordStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file = path.join(process.cwd(), "data", "records.json")) {}

  private async load(): Promise<Db> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Db;
    } catch {
      return { records: {}, lastWin: {}, days: {} };
    }
  }

  private async save(db: Db) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(db));
    await rename(tmp, this.file);
  }

  // Writes run one at a time so two quick requests cannot overwrite each other.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getRecord(tokenId: number) {
    return (await this.load()).records[tokenId] ?? emptyRecord(tokenId);
  }

  async listRecords() {
    return Object.values((await this.load()).records);
  }

  submit(result: DayResult): Promise<SubmitOutcome> {
    return this.serial(async () => {
      const db = await this.load();
      const key = `${result.tokenId}:${result.date}`;
      const cur = db.records[result.tokenId] ?? emptyRecord(result.tokenId);
      if (db.days[key]) return { ok: false as const, reason: "already-played" as const, record: cur };
      const { rec, lastWinDate } = applyResult(cur, result, db.lastWin[result.tokenId] ?? null);
      db.records[result.tokenId] = rec;
      if (lastWinDate) db.lastWin[result.tokenId] = lastWinDate;
      db.days[key] = result;
      await this.save(db);
      return { ok: true as const, record: rec };
    });
  }

  cotdStart(entry: CotdEntry): Promise<CotdStart> {
    return this.serial(async () => {
      const db = await this.load();
      const day = ((db.cotd ??= {})[entry.date] ??= {});
      if (day[entry.wallet]) return { ok: false as const, entry: day[entry.wallet] };
      day[entry.wallet] = entry;
      await this.save(db);
      return { ok: true as const, entry };
    });
  }

  cotdFinish(date: string, wallet: string, r: CotdResult): Promise<CotdFinish> {
    return this.serial(async () => {
      const db = await this.load();
      const cur = db.cotd?.[date]?.[wallet];
      if (!cur) return { ok: false as const, reason: "not-started" as const };
      if (cur.finishedAt) return { ok: false as const, reason: "already-finished" as const, entry: cur };
      const entry = finishEntry(cur, r);
      db.cotd![date][wallet] = entry;
      await this.save(db);
      return { ok: true as const, entry };
    });
  }

  async cotdEntries(date: string) {
    return Object.values((await this.load()).cotd?.[date] ?? {});
  }

  async cotdEntry(date: string, wallet: string) {
    return (await this.load()).cotd?.[date]?.[wallet] ?? null;
  }

  claimLock(claim: PortalClaim): Promise<ClaimLock> {
    return this.serial(async () => {
      const db = await this.load();
      const cur = (db.claims ??= {})[claim.tokenId];
      if (cur) return { ok: false as const, claim: cur };
      db.claims[claim.tokenId] = claim;
      await this.save(db);
      return { ok: true as const, claim };
    });
  }

  claimSave(claim: PortalClaim): Promise<void> {
    return this.serial(async () => {
      const db = await this.load();
      (db.claims ??= {})[claim.tokenId] = claim;
      await this.save(db);
    });
  }

  claimDrop(tokenId: number): Promise<void> {
    return this.serial(async () => {
      const db = await this.load();
      if (db.claims) delete db.claims[tokenId];
      await this.save(db);
    });
  }

  async claimGet(tokenId: number) {
    return (await this.load()).claims?.[tokenId] ?? null;
  }

  async claimList() {
    return Object.values((await this.load()).claims ?? {});
  }

  async featuredGet(date: string) {
    return (await this.load()).featured?.[date] ?? null;
  }

  featuredSet(date: string, tokenId: number): Promise<number> {
    return this.serial(async () => {
      const db = await this.load();
      const cur = (db.featured ??= {})[date];
      if (cur) return cur;
      db.featured[date] = tokenId;
      await this.save(db);
      return tokenId;
    });
  }

  movesAdd(game: string, move: StoredMove): Promise<void> {
    return this.serial(async () => {
      const db = await this.load();
      ((db.moves ??= {})[game] ??= []).push(move);
      await this.save(db);
    });
  }

  async movesGet(game: string) {
    return (await this.load()).moves?.[game] ?? [];
  }
}

// Hosted store on Upstash Redis over its REST API (plain fetch, no extra package).
// Keys: portal:ids (set of token ids), portal:rec:ID, portal:lastwin:ID, portal:day:ID:DATE (the
// one-result-per-day lock) and cotd:DATE (hash of wallet to entry).
// portal:claims (hash of Portal number to its claim: who won it, and the mint), portal:featured:DATE
// and portal:moves:GAME (list of the moves of one live game).
type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class UpstashRecordStore implements RecordStore {
  private url: string;
  constructor(url: string, private token: string, private doFetch: Fetch = fetch as unknown as Fetch) {
    this.url = url.replace(/\/+$/, "");
  }

  protected async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await this.doFetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
    return body.result as T;
  }

  private parse<T>(raw: unknown): T | null {
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  }

  async getRecord(tokenId: number) {
    return this.parse<PortalRecord>(await this.cmd("GET", `portal:rec:${tokenId}`)) ?? emptyRecord(tokenId);
  }

  async listRecords() {
    const ids = await this.cmd<string[]>("SMEMBERS", "portal:ids");
    if (!ids.length) return [];
    const rows = await this.cmd<(string | null)[]>("MGET", ...ids.map((id) => `portal:rec:${id}`));
    return rows.map((r) => this.parse<PortalRecord>(r)).filter((r): r is PortalRecord => r !== null);
  }

  async submit(result: DayResult): Promise<SubmitOutcome> {
    const id = result.tokenId;
    const cur = await this.getRecord(id);
    // SET NX is the one-result-per-day lock, so two quick requests cannot both count.
    const first = await this.cmd("SET", `portal:day:${id}:${result.date}`, JSON.stringify(result), "NX");
    if (first !== "OK") return { ok: false, reason: "already-played", record: cur };
    const lastWin = await this.cmd<string | null>("GET", `portal:lastwin:${id}`);
    const { rec, lastWinDate } = applyResult(cur, result, lastWin);
    await this.cmd("SET", `portal:rec:${id}`, JSON.stringify(rec));
    if (lastWinDate) await this.cmd("SET", `portal:lastwin:${id}`, lastWinDate);
    await this.cmd("SADD", "portal:ids", id);
    return { ok: true, record: rec };
  }

  async cotdStart(entry: CotdEntry): Promise<CotdStart> {
    const made = await this.cmd<number>("HSETNX", `cotd:${entry.date}`, entry.wallet, JSON.stringify(entry));
    if (made === 1) return { ok: true, entry };
    return { ok: false, entry: (await this.cotdEntry(entry.date, entry.wallet)) ?? entry };
  }

  async cotdFinish(date: string, wallet: string, r: CotdResult): Promise<CotdFinish> {
    const cur = await this.cotdEntry(date, wallet);
    if (!cur) return { ok: false, reason: "not-started" };
    if (cur.finishedAt) return { ok: false, reason: "already-finished", entry: cur };
    const entry = finishEntry(cur, r);
    await this.cmd("HSET", `cotd:${date}`, wallet, JSON.stringify(entry));
    return { ok: true, entry };
  }

  async cotdEntries(date: string) {
    const flat = await this.cmd<string[]>("HGETALL", `cotd:${date}`);
    const out: CotdEntry[] = [];
    for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]) as CotdEntry);
    return out;
  }

  async cotdEntry(date: string, wallet: string) {
    return this.parse<CotdEntry>(await this.cmd("HGET", `cotd:${date}`, wallet));
  }

  async claimLock(claim: PortalClaim): Promise<ClaimLock> {
    // HSETNX is the one-claim-per-Portal lock: two winners pressing Claim at once cannot both mint.
    const made = await this.cmd<number>("HSETNX", "portal:claims", claim.tokenId, JSON.stringify(claim));
    if (made === 1) return { ok: true, claim };
    return { ok: false, claim: (await this.claimGet(claim.tokenId)) ?? claim };
  }

  async claimSave(claim: PortalClaim) {
    await this.cmd("HSET", "portal:claims", claim.tokenId, JSON.stringify(claim));
  }

  async claimDrop(tokenId: number) {
    await this.cmd("HDEL", "portal:claims", tokenId);
  }

  async claimGet(tokenId: number) {
    return this.parse<PortalClaim>(await this.cmd("HGET", "portal:claims", tokenId));
  }

  async claimList() {
    const flat = await this.cmd<string[]>("HGETALL", "portal:claims");
    const out: PortalClaim[] = [];
    for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]) as PortalClaim);
    return out;
  }

  async featuredGet(date: string) {
    const raw = await this.cmd<string | null>("GET", `portal:featured:${date}`);
    return raw ? Number(raw) : null;
  }

  async featuredSet(date: string, tokenId: number) {
    await this.cmd("SET", `portal:featured:${date}`, tokenId, "NX");
    return (await this.featuredGet(date)) ?? tokenId;
  }

  // RPUSH keeps the order moves arrived in. Logs are only needed while a day is live, so they expire.
  async movesAdd(game: string, move: StoredMove) {
    await this.cmd("RPUSH", `portal:moves:${game}`, JSON.stringify(move));
    await this.cmd("EXPIRE", `portal:moves:${game}`, 3 * 86_400);
  }

  async movesGet(game: string) {
    const rows = await this.cmd<string[]>("LRANGE", `portal:moves:${game}`, 0, -1);
    return rows.map((r) => JSON.parse(r) as StoredMove);
  }
}

// The same store over plain Redis (REDIS_URL) instead of Upstash's REST API.
export class RedisUrlRecordStore extends UpstashRecordStore {
  constructor(private redisUrl: string) {
    super("", "");
  }

  protected async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    return redisUrlCommand<T>(this.redisUrl, args);
  }
}

let store: RecordStore | undefined;
export function getStore(): RecordStore {
  if (store) return store;
  if (process.env.REDIS_URL) return (store = new RedisUrlRecordStore(process.env.REDIS_URL));
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return (store = url && token ? new UpstashRecordStore(url, token) : new FileRecordStore(process.env.PORTAL_RECORDS_FILE));
}
export function setStore(s: RecordStore) {
  store = s;
}
