import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { keccak256, toBytes, type Hex } from "viem";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function assertDate(date: string) {
  if (!isValidDate(date)) throw new Error(`Bad date "${date}". Use YYYY-MM-DD (UTC).`);
}

let cachedSecret: string | undefined;

// Reads the server secret. In local dev only, a random one is created in .env.local
// the first time it is needed. The value is never logged.
function getSecret(): string {
  const fromEnv = process.env.POT_SALT_SECRET;
  if (fromEnv) return fromEnv;
  if (cachedSecret) return cachedSecret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("POT_SALT_SECRET is not set. Add a long random value to the server environment.");
  }
  const file = path.join(process.cwd(), ".env.local");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(/^POT_SALT_SECRET=(.+)$/m);
    if (m) return (cachedSecret = m[1].trim());
  }
  const secret = randomBytes(32).toString("hex");
  appendFileSync(file, `${existsSync(file) ? "\n" : ""}POT_SALT_SECRET=${secret}\n`);
  cachedSecret = secret;
  console.warn("[salt] POT_SALT_SECRET was missing, so a random one was saved to .env.local for local dev.");
  return secret;
}

// Daily salt: HMAC-SHA256 of the UTC date. Returned as 0x hex.
export function getDailySalt(date: string): Hex {
  assertDate(date);
  return `0x${createHmac("sha256", getSecret()).update(date).digest("hex")}`;
}

// Same rule as the engine's saltCommit: keccak256 of the salt text as bytes.
export function commitOf(salt: string): Hex {
  return keccak256(toBytes(salt));
}

export function dailyCommit(date: string): Hex {
  return commitOf(getDailySalt(date));
}

// True only once the whole UTC day is over (from 00:00 UTC the next day).
export function isRevealable(date: string, now: Date = new Date()): boolean {
  assertDate(date);
  return now.getTime() >= Date.parse(`${date}T00:00:00Z`) + DAY_MS;
}
