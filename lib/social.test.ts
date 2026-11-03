import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import { MemorySocialStore, answerRequest, claimUsername, cleanName, myFriends, requestFriend, sendInvite, unfriend, whoIs, type SocialDeps } from "./social";
import { socialLoginMessage } from "./social-message";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const T0 = Date.parse("2026-11-03T12:00:00Z");

function make() {
  const records = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "social-")), "r.json"));
  const deps: SocialDeps = { social: new MemorySocialStore(), records, now: () => T0, recover: async (msg, sig) => (msg === socialLoginMessage("2026-11-03") || msg === socialLoginMessage("2026-11-02") ? sig : "0x0") };
  return { deps, records };
}
const challenge = (id: string, creator: string, expiresAt = T0 + 86_400_000) => ({ id, seed: "0x01", tokenId: 3, date: "2026-11-03", creator, createdAt: T0, expiresAt });

describe("usernames", () => {
  it("cleans names", () => {
    expect(cleanName(" @Sire_Adell ")).toBe("sire_adell");
    expect(cleanName("ab")).toBeNull();
    expect(cleanName("has space")).toBeNull();
    expect(cleanName("x".repeat(17))).toBeNull();
    expect(cleanName(5)).toBeNull();
  });
  it("gives each name to one wallet and each wallet one name", async () => {
    const { deps } = make();
    expect(await claimUsername(deps, A, "sireadell")).toEqual({ ok: true, username: "sireadell" });
    expect(await claimUsername(deps, B, "SireAdell")).toMatchObject({ ok: false, status: 409 });
    expect(await claimUsername(deps, A, "another")).toMatchObject({ ok: false, status: 409 });
    expect(await claimUsername(deps, B, "x")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("signing in", () => {
  it("accepts today's and yesterday's sign-in from the right wallet only", async () => {
    const { deps } = make();
    expect(await whoIs(deps, A.toUpperCase().replace("0X", "0x"), A.toUpperCase().replace("0X", "0x"))).toBe(A);
    expect(await whoIs({ ...deps, recover: async () => B }, A, "0xsig")).toMatchObject({ ok: false, status: 401 });
    expect(await whoIs(deps, "nope", "0xsig")).toMatchObject({ ok: false, status: 400 });
  });
});

async function befriend(deps: SocialDeps) {
  await claimUsername(deps, A, "alice");
  await claimUsername(deps, B, "bob");
  await requestFriend(deps, A, "bob");
  await answerRequest(deps, B, "alice", true);
}

describe("friends", () => {
  it("needs a username, an asker and an accept", async () => {
    const { deps } = make();
    expect(await requestFriend(deps, A, "bob")).toMatchObject({ ok: false, status: 400 }); // no username yet
    await claimUsername(deps, A, "alice");
    await claimUsername(deps, B, "bob");
    expect(await requestFriend(deps, A, "nobody")).toMatchObject({ ok: false, status: 404 });
    expect(await requestFriend(deps, A, "alice")).toMatchObject({ ok: false, status: 400 });
    expect(await requestFriend(deps, A, "bob")).toEqual({ ok: true, status: "requested" });
    expect((await myFriends(deps, B)).requests.map((p) => p.name)).toEqual(["alice"]);
    expect((await myFriends(deps, A)).friends).toEqual([]);
    expect(await answerRequest(deps, B, "alice", true)).toEqual({ ok: true });
    expect((await myFriends(deps, A)).friends.map((p) => p.name)).toEqual(["bob"]);
    expect((await myFriends(deps, B)).friends.map((p) => p.name)).toEqual(["alice"]);
    expect(await requestFriend(deps, A, "bob")).toMatchObject({ ok: false, status: 409 });
  });
  it("makes friends at once when both ask each other, and lets a request be declined", async () => {
    const { deps } = make();
    await claimUsername(deps, A, "alice");
    await claimUsername(deps, B, "bob");
    await claimUsername(deps, C, "carol");
    await requestFriend(deps, A, "bob");
    expect(await requestFriend(deps, B, "alice")).toEqual({ ok: true, status: "friends" });
    await requestFriend(deps, C, "alice");
    expect(await answerRequest(deps, A, "carol", false)).toEqual({ ok: true });
    expect((await myFriends(deps, A)).friends.map((p) => p.name)).toEqual(["bob"]);
    expect(await answerRequest(deps, A, "carol", true)).toMatchObject({ ok: false, status: 404 });
  });
  it("can end a friendship for both", async () => {
    const { deps } = make();
    await befriend(deps);
    await unfriend(deps, A, "bob");
    expect((await myFriends(deps, A)).friends).toEqual([]);
    expect((await myFriends(deps, B)).friends).toEqual([]);
  });
});

describe("invites", () => {
  it("lands in a friend's inbox, and only for a live challenge the sender made", async () => {
    const { deps, records } = make();
    await befriend(deps);
    await records.challengeCreate(challenge("aaaaaaaaaaaa", A));
    await records.challengeCreate(challenge("bbbbbbbbbbbb", B));
    await records.challengeCreate(challenge("cccccccccccc", A, T0 - 1));
    expect(await sendInvite(deps, A, "bob", "aaaaaaaaaaaa")).toEqual({ ok: true });
    expect(await sendInvite(deps, A, "bob", "bbbbbbbbbbbb")).toMatchObject({ ok: false, status: 403 }); // not mine
    expect(await sendInvite(deps, A, "bob", "cccccccccccc")).toMatchObject({ ok: false, status: 410 }); // expired
    expect(await sendInvite(deps, A, "bob", "dddddddddddd")).toMatchObject({ ok: false, status: 404 });
    const inbox = (await myFriends(deps, B)).invites;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ challengeId: "aaaaaaaaaaaa", fromName: "alice" });
    expect((await myFriends(deps, A)).invites).toEqual([]);
  });
  it("refuses a stranger and drops an invite once the challenge expires", async () => {
    const { deps, records } = make();
    await claimUsername(deps, A, "alice");
    await claimUsername(deps, C, "carol");
    await records.challengeCreate(challenge("aaaaaaaaaaaa", A));
    expect(await sendInvite(deps, A, "carol", "aaaaaaaaaaaa")).toMatchObject({ ok: false, status: 403 });
    await befriend(deps);
    await sendInvite(deps, A, "bob", "aaaaaaaaaaaa");
    expect((await myFriends({ ...deps, now: () => T0 + 2 * 86_400_000 }, B)).invites).toEqual([]);
  });
});
