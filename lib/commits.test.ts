import { afterEach, describe, expect, it, vi } from "vitest";
import { findCommit, readStoredPost, saveStoredPost } from "./commits";

const post = { date: "2030-01-01", commit: "0xabc", txHash: "0xdef" };

function fakeRedis() {
  const data = new Map<string, string>();
  const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const [cmd, key, value] = JSON.parse(String(init?.body));
    if (cmd === "SET") data.set(key, value);
    const result = cmd === "GET" ? (data.get(key) ?? null) : "OK";
    return { ok: true, status: 200, json: async () => ({ result }) } as Response;
  });
  return fn as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllEnvs());

describe("stored daily posts", () => {
  it("does nothing without Upstash set up", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    expect(await saveStoredPost(post, fakeRedis())).toBe(false);
    expect(await readStoredPost(post.date, fakeRedis())).toBeUndefined();
  });

  it("saves a post and finds it again, including through findCommit", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const f = fakeRedis();
    expect(await saveStoredPost(post, f)).toBe(true);
    expect(await readStoredPost(post.date, f)).toEqual(post);
    expect(await findCommit(post.date, f)).toEqual(post);
  });

  it("returns nothing for a day that was never posted", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    expect(await findCommit("2031-02-02", fakeRedis())).toBeUndefined();
  });
});
