// Usernames, friends and challenge invites. A name belongs to one wallet and is picked once. Friends are
// mutual: one asks, the other accepts. An invite is a challenge link sent to a friend, shown in their inbox.
// Everything is keyed by lowercase wallet. Writes need a wallet signature (checked by whoIs).
import { recoverMessageAddress, type Hex } from "viem";
import { redisUrlCommand } from "./redisUrl";
import { socialLoginMessage } from "./social-message";
import { addDays, utcToday } from "./salt";
import type { RecordStore } from "./records";

export const NAME_RE = /^[a-z0-9_]{3,16}$/;
export type Invite = { challengeId: string; from: string; fromName: string; at: number };
export type Person = { wallet: string; name: string };

export interface SocialStore {
  claimName(wallet: string, name: string): Promise<"ok" | "taken" | "has-name">;
  nameOf(wallet: string): Promise<string | null>;
  walletOf(name: string): Promise<string | null>;
  addRequest(to: string, from: string): Promise<void>;
  removeRequest(to: string, from: string): Promise<void>;
  requestsFor(to: string): Promise<string[]>;
  addFriend(a: string, b: string): Promise<void>;
  removeFriend(a: string, b: string): Promise<void>;
  friendsOf(w: string): Promise<string[]>;
  addInvite(to: string, inv: Invite): Promise<void>;
  invitesFor(to: string): Promise<Invite[]>;
  removeInvite(to: string, challengeId: string): Promise<void>;
}

export class MemorySocialStore implements SocialStore {
  private names = new Map<string, string>(); // name -> wallet
  private wallets = new Map<string, string>(); // wallet -> name
  private req = new Map<string, Set<string>>();
  private fr = new Map<string, Set<string>>();
  private inv = new Map<string, Map<string, Invite>>();
  private set = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!;
  async claimName(w: string, n: string) {
    if (this.wallets.has(w)) return "has-name" as const;
    if (this.names.has(n)) return "taken" as const;
    this.names.set(n, w);
    this.wallets.set(w, n);
    return "ok" as const;
  }
  async nameOf(w: string) { return this.wallets.get(w) ?? null; }
  async walletOf(n: string) { return this.names.get(n) ?? null; }
  async addRequest(to: string, from: string) { this.set(this.req, to).add(from); }
  async removeRequest(to: string, from: string) { this.req.get(to)?.delete(from); }
  async requestsFor(to: string) { return [...(this.req.get(to) ?? [])]; }
  async addFriend(a: string, b: string) { this.set(this.fr, a).add(b); this.set(this.fr, b).add(a); }
  async removeFriend(a: string, b: string) { this.fr.get(a)?.delete(b); this.fr.get(b)?.delete(a); }
  async friendsOf(w: string) { return [...(this.fr.get(w) ?? [])]; }
  async addInvite(to: string, i: Invite) { (this.inv.get(to) ?? this.inv.set(to, new Map()).get(to)!).set(i.challengeId, i); }
  async invitesFor(to: string) { return [...(this.inv.get(to)?.values() ?? [])]; }
  async removeInvite(to: string, id: string) { this.inv.get(to)?.delete(id); }
}

// Same Redis the rest of the site uses: REDIS_URL, else Upstash REST.
export class RedisSocialStore implements SocialStore {
  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    if (process.env.REDIS_URL) return redisUrlCommand<T>(process.env.REDIS_URL, args);
    const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "").replace(/\/+$/, "");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
    return (body.result ?? null) as T;
  }
  async claimName(w: string, n: string) {
    if (await this.cmd("GET", `social:wallet:${w}`)) return "has-name" as const;
    if ((await this.cmd("SET", `social:name:${n}`, w, "NX")) !== "OK") return "taken" as const;
    await this.cmd("SET", `social:wallet:${w}`, n);
    return "ok" as const;
  }
  async nameOf(w: string) { return (await this.cmd<string | null>("GET", `social:wallet:${w}`)) ?? null; }
  async walletOf(n: string) { return (await this.cmd<string | null>("GET", `social:name:${n}`)) ?? null; }
  async addRequest(to: string, from: string) { await this.cmd("SADD", `social:req:${to}`, from); }
  async removeRequest(to: string, from: string) { await this.cmd("SREM", `social:req:${to}`, from); }
  async requestsFor(to: string) { return (await this.cmd<string[] | null>("SMEMBERS", `social:req:${to}`)) ?? []; }
  async addFriend(a: string, b: string) {
    await this.cmd("SADD", `social:friends:${a}`, b);
    await this.cmd("SADD", `social:friends:${b}`, a);
  }
  async removeFriend(a: string, b: string) {
    await this.cmd("SREM", `social:friends:${a}`, b);
    await this.cmd("SREM", `social:friends:${b}`, a);
  }
  async friendsOf(w: string) { return (await this.cmd<string[] | null>("SMEMBERS", `social:friends:${w}`)) ?? []; }
  async addInvite(to: string, i: Invite) { await this.cmd("HSET", `social:inv:${to}`, i.challengeId, JSON.stringify(i)); }
  async invitesFor(to: string) {
    const flat = (await this.cmd<string[] | null>("HGETALL", `social:inv:${to}`)) ?? [];
    const out: Invite[] = [];
    for (let k = 1; k < flat.length; k += 2) {
      try { out.push(JSON.parse(flat[k]) as Invite); } catch { /* skip a bad row */ }
    }
    return out;
  }
  async removeInvite(to: string, id: string) { await this.cmd("HDEL", `social:inv:${to}`, id); }
}

let memory: MemorySocialStore | undefined;
export function getSocialStore(): SocialStore {
  const hosted =
    process.env.REDIS_URL ||
    ((process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN));
  return hosted ? new RedisSocialStore() : (memory ??= new MemorySocialStore());
}

// ---------------------------------------------------------------------------
export type SocialDeps = {
  social: SocialStore;
  records: RecordStore; // to check a challenge before inviting someone to it
  now?: () => number;
  recover?: (message: string, signature: string) => Promise<string>;
};
export type SocialError = { ok: false; status: number; error: string };
const fail = (status: number, error: string): SocialError => ({ ok: false, status, error });

const recoverDefault = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });

// Who is calling: the wallet that signed today's (or yesterday's) sign-in text.
export async function whoIs(deps: SocialDeps, address: unknown, signature: unknown): Promise<string | SocialError> {
  if (typeof address !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return fail(400, "Connect your wallet and sign in first.");
  const today = utcToday(new Date((deps.now ?? Date.now)()));
  for (const d of [today, addDays(today, -1)]) {
    try {
      const w = await (deps.recover ?? recoverDefault)(socialLoginMessage(d), signature);
      if (w.toLowerCase() === address.toLowerCase()) return address.toLowerCase();
    } catch {
      /* try the other day */
    }
  }
  return fail(401, "That sign-in does not match your wallet. Sign in again.");
}

export const cleanName = (x: unknown): string | null => {
  const n = typeof x === "string" ? x.trim().toLowerCase().replace(/^@/, "") : "";
  return NAME_RE.test(n) ? n : null;
};

const person = async (s: SocialStore, wallet: string): Promise<Person> => ({ wallet, name: (await s.nameOf(wallet)) ?? wallet.slice(0, 6) });

export type Me = { username: string | null; friends: Person[]; requests: Person[]; invites: Invite[] };

export async function myFriends(deps: SocialDeps, wallet: string): Promise<Me> {
  const now = (deps.now ?? Date.now)();
  const s = deps.social;
  const [username, fr, rq, inv] = await Promise.all([s.nameOf(wallet), s.friendsOf(wallet), s.requestsFor(wallet), s.invitesFor(wallet)]);
  const invites: Invite[] = [];
  for (const i of inv.sort((a, b) => b.at - a.at)) {
    const ch = await deps.records.challengeGet(i.challengeId);
    if (!ch || now > ch.expiresAt) {
      await s.removeInvite(wallet, i.challengeId); // gone or expired
      continue;
    }
    invites.push(i);
  }
  return { username, friends: await Promise.all(fr.map((w) => person(s, w))), requests: await Promise.all(rq.map((w) => person(s, w))), invites };
}

export async function claimUsername(deps: SocialDeps, wallet: string, raw: unknown): Promise<{ ok: true; username: string } | SocialError> {
  const name = cleanName(raw);
  if (!name) return fail(400, "A username is 3 to 16 letters, numbers or underscores.");
  const r = await deps.social.claimName(wallet, name);
  if (r === "has-name") return fail(409, "You already have a username, and it cannot be changed.");
  if (r === "taken") return fail(409, "That username is taken. Try another.");
  return { ok: true, username: name };
}

export async function requestFriend(deps: SocialDeps, wallet: string, toName: unknown): Promise<{ ok: true; status: "requested" | "friends" } | SocialError> {
  const s = deps.social;
  if (!(await s.nameOf(wallet))) return fail(400, "Pick a username first.");
  const name = cleanName(toName);
  const to = name ? await s.walletOf(name) : null;
  if (!to) return fail(404, "No player has that username.");
  if (to === wallet) return fail(400, "That is you.");
  if ((await s.friendsOf(wallet)).includes(to)) return fail(409, "You are already friends.");
  if ((await s.requestsFor(wallet)).includes(to)) {
    // they already asked me, so asking back makes us friends
    await s.removeRequest(wallet, to);
    await s.addFriend(wallet, to);
    return { ok: true, status: "friends" };
  }
  await s.addRequest(to, wallet);
  return { ok: true, status: "requested" };
}

export async function answerRequest(deps: SocialDeps, wallet: string, fromName: unknown, accept: boolean): Promise<{ ok: true } | SocialError> {
  const name = cleanName(fromName);
  const from = name ? await deps.social.walletOf(name) : null;
  if (!from || !(await deps.social.requestsFor(wallet)).includes(from)) return fail(404, "That request is gone.");
  await deps.social.removeRequest(wallet, from);
  if (accept) await deps.social.addFriend(wallet, from);
  return { ok: true };
}

export async function unfriend(deps: SocialDeps, wallet: string, name: unknown): Promise<{ ok: true } | SocialError> {
  const n = cleanName(name);
  const other = n ? await deps.social.walletOf(n) : null;
  if (!other) return fail(404, "No player has that username.");
  await deps.social.removeFriend(wallet, other);
  return { ok: true };
}

export async function sendInvite(deps: SocialDeps, wallet: string, toName: unknown, challengeId: unknown): Promise<{ ok: true } | SocialError> {
  const s = deps.social;
  const now = (deps.now ?? Date.now)();
  const mine = await s.nameOf(wallet);
  if (!mine) return fail(400, "Pick a username first.");
  const n = cleanName(toName);
  const to = n ? await s.walletOf(n) : null;
  if (!to || !(await s.friendsOf(wallet)).includes(to)) return fail(403, "You can only invite your friends.");
  const ch = typeof challengeId === "string" ? await deps.records.challengeGet(challengeId) : null;
  if (!ch) return fail(404, "That challenge does not exist.");
  if (ch.creator !== wallet) return fail(403, "Only the player who made a challenge can invite to it.");
  if (now > ch.expiresAt) return fail(410, "That challenge link has expired.");
  await s.addInvite(to, { challengeId: ch.id, from: wallet, fromName: mine, at: now });
  return { ok: true };
}
