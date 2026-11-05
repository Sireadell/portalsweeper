// A tiny key-value store for the SHARD economy: award markers, redeem locks, counters and the held list.
// It talks to the same Redis the game already uses (REDIS_URL or Upstash), and falls back to a local file in development.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redisUrlCommand } from "./redisUrl";

export interface Kv {
  // Sets the key only when it is not there yet. True when this call set it.
  setnx(key: string, value: string): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  incrby(key: string, n: number): Promise<number>;
}

export class MemoryKv implements Kv {
  private m = new Map<string, string>();
  async setnx(key: string, value: string) {
    if (this.m.has(key)) return false;
    this.m.set(key, value);
    return true;
  }
  async get(key: string) {
    return this.m.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.m.set(key, value);
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async incrby(key: string, n: number) {
    const v = Number(this.m.get(key) ?? 0) + n;
    this.m.set(key, String(v));
    return v;
  }
}

// Redis over a command function (plain Redis or Upstash REST both fit this shape).
export class RedisKv implements Kv {
  constructor(private cmd: <T = unknown>(...args: (string | number)[]) => Promise<T>) {}
  async setnx(key: string, value: string) {
    return (await this.cmd<string | null>("SET", key, value, "NX")) === "OK";
  }
  async get(key: string) {
    const v = await this.cmd<string | null>("GET", key);
    return typeof v === "string" ? v : null;
  }
  async set(key: string, value: string) {
    await this.cmd("SET", key, value);
  }
  async del(key: string) {
    await this.cmd("DEL", key);
  }
  async incrby(key: string, n: number) {
    return Number(await this.cmd<number>("INCRBY", key, n));
  }
}

// Local development only: one JSON file, writes one at a time.
export class FileKv implements Kv {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file = path.join(process.cwd(), "data", "shard-kv.json")) {}
  private serial<T>(fn: (db: Record<string, string>) => T | Promise<T>, write: boolean): Promise<T> {
    const run = this.queue.then(async () => {
      let db: Record<string, string> = {};
      try {
        db = JSON.parse(await readFile(this.file, "utf8"));
      } catch { /* first use */ }
      const out = await fn(db);
      if (write) {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(db));
        await rename(`${this.file}.tmp`, this.file);
      }
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  setnx(key: string, value: string) {
    return this.serial((db) => (key in db ? false : ((db[key] = value), true)), true);
  }
  get(key: string) {
    return this.serial((db) => db[key] ?? null, false);
  }
  async set(key: string, value: string) {
    await this.serial((db) => void (db[key] = value), true);
  }
  async del(key: string) {
    await this.serial((db) => void delete db[key], true);
  }
  incrby(key: string, n: number) {
    return this.serial((db) => {
      const v = Number(db[key] ?? 0) + n;
      db[key] = String(v);
      return v;
    }, true);
  }
}

let kv: Kv | undefined;
export function getKv(): Kv {
  if (kv) return kv;
  if (process.env.REDIS_URL) {
    const url = process.env.REDIS_URL;
    return (kv = new RedisKv((...args) => redisUrlCommand(url, args) as never));
  }
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)?.replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    return (kv = new RedisKv(async (...args) => {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
      const body = (await res.json()) as { result?: unknown; error?: string };
      if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
      return body.result as never;
    }));
  }
  return (kv = new FileKv());
}
export function setKv(k: Kv) {
  kv = k;
}
