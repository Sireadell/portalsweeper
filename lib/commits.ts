import { readFile } from "node:fs/promises";
import path from "node:path";
import { redisUrlCommand } from "./redisUrl";

export type CommitPost = { date: string; commit: string; txHash: string | null; block?: number };

const FILE = () => path.join(process.cwd(), "data", "commits.json");

export async function readCommits(): Promise<CommitPost[]> {
  try {
    const raw = JSON.parse(await readFile(FILE(), "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

// Posts made by the daily timer live in Upstash, because a hosted site cannot write to its own files.
type Fetcher = typeof fetch;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(args: string[], doFetch: Fetcher): Promise<unknown> {
  if (process.env.REDIS_URL) return (await redisUrlCommand(process.env.REDIS_URL, args)) ?? null;
  const cfg = redisConfig();
  if (!cfg) return null;
  const res = await doFetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
  return body.result ?? null;
}

export async function readStoredPost(date: string, doFetch: Fetcher = fetch): Promise<CommitPost | undefined> {
  try {
    const raw = await redis(["GET", `commit:${date}`], doFetch);
    return typeof raw === "string" ? (JSON.parse(raw) as CommitPost) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveStoredPost(post: CommitPost, doFetch: Fetcher = fetch): Promise<boolean> {
  if (!redisConfig()) return false;
  await redis(["SET", `commit:${post.date}`, JSON.stringify(post)], doFetch);
  return true;
}

export async function findCommit(date: string, doFetch: Fetcher = fetch): Promise<CommitPost | undefined> {
  const fromFile = (await readCommits()).find((c) => c.date === date && c.txHash);
  return fromFile ?? (await readStoredPost(date, doFetch)) ?? (await readCommits()).find((c) => c.date === date);
}
