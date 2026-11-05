import { describe, expect, it } from "vitest";
import { redeem, redeemMessage, REDEEMS_PER_DAY, REDEEM_PRICE, type RedeemDeps } from "./redeem";
import { MemoryKv } from "./shardKv";
import { burnedKey } from "./shardAward";
import { redeemBatch, redeemCalls, awardCalls, type ShardBatchApi } from "./shardBatch";

const W = "0x" + "a".repeat(40);
const NOW = Date.UTC(2026, 10, 6, 12);

function setup(o: { balance?: number; taken?: number[]; sendFails?: string } = {}) {
  const kv = new MemoryKv();
  const sent: { wallet: string; portal: number; note: string }[] = [];
  const taken = new Set(o.taken ?? [102, 103, 104]);
  const deps: RedeemDeps = {
    kv,
    now: () => NOW,
    recover: async (message, signature) => (signature.startsWith("sig-") ? signature.slice(4, 4 + 42) : "0xbad"),
    portalOwner: async (id) => (taken.has(id) ? "owner" : null),
    shardBalance: async () => o.balance ?? 100,
    send: async (x) => {
      if (o.sendFails) throw new Error(o.sendFails);
      sent.push(x);
      return { txHash: "0xredeem" + sent.length, block: 77 };
    },
  };
  return { kv, deps, sent, taken };
}
const req = (portal: number, extra: Partial<{ address: string; signature: string; issuedAt: number }> = {}, wallet = W) => ({
  address: wallet,
  signature: `sig-${wallet}-${portal}-${Math.random()}`,
  portal,
  issuedAt: NOW,
  ...extra,
});

describe("redeem", () => {
  it("mints the chosen Portal for 100 SHARD in one send", async () => {
    const t = setup();
    const out = await redeem(t.deps, req(7));
    expect(out).toMatchObject({ ok: true, portal: 7, txHash: "0xredeem1", block: 77 });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ wallet: W.toLowerCase(), portal: 7 });
    expect(t.sent[0].note).toMatch(/^portalsweeper:redeem:7:0x[0-9a-f]{16}$/);
    expect(await t.kv.get(burnedKey)).toBe(String(REDEEM_PRICE));
  });

  it("refuses a wallet with less than 100 SHARD and sends nothing", async () => {
    const t = setup({ balance: 99 });
    const out = await redeem(t.deps, req(7));
    expect(out).toMatchObject({ ok: false, status: 402 });
    expect(t.sent).toHaveLength(0);
  });

  it("refuses a Portal that is already minted (102, 103, 104)", async () => {
    const t = setup();
    for (const id of [102, 103, 104]) expect(await redeem(t.deps, req(id))).toMatchObject({ ok: false, status: 409 });
    expect(t.sent).toHaveLength(0);
  });

  it("refuses numbers outside 1 to 500", async () => {
    const t = setup();
    for (const id of [0, 501, -1, 1.5, NaN]) expect(await redeem(t.deps, req(id))).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a signature from another wallet", async () => {
    const t = setup();
    const other = "0x" + "b".repeat(40);
    const out = await redeem(t.deps, { ...req(7), signature: `sig-${other}-x` });
    expect(out).toMatchObject({ ok: false, status: 401 });
    expect(t.sent).toHaveLength(0);
  });

  it("refuses an old signature", async () => {
    const t = setup();
    expect(await redeem(t.deps, req(7, { issuedAt: NOW - 11 * 60 * 1000 }))).toMatchObject({ ok: false, status: 400 });
  });

  it("answers a repeated signature with the first result and sends once", async () => {
    const t = setup();
    const r = req(7);
    const a = await redeem(t.deps, r);
    const b = await redeem(t.deps, r);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true, again: true, txHash: "0xredeem1" });
    expect(t.sent).toHaveLength(1);
  });

  it("does not let a second wallet take the same Portal", async () => {
    const t = setup();
    await redeem(t.deps, req(7));
    const w2 = "0x" + "b".repeat(40);
    // the chain now shows Portal 7 as taken
    t.taken.add(7);
    expect(await redeem(t.deps, req(7, {}, w2))).toMatchObject({ ok: false, status: 409 });
    expect(t.sent).toHaveLength(1);
  });

  it("two wallets racing for the same free Portal: only one gets it", async () => {
    const t = setup();
    const w2 = "0x" + "b".repeat(40);
    const [x, y] = await Promise.all([redeem(t.deps, req(9)), redeem(t.deps, req(9, {}, w2))]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });

  it("stops after the daily limit and counts a failed send back", async () => {
    const t = setup();
    for (let i = 0; i < REDEEMS_PER_DAY; i++) expect((await redeem(t.deps, req(10 + i))).ok).toBe(true);
    expect(await redeem(t.deps, req(20))).toMatchObject({ ok: false, status: 429 });
    const f = setup({ sendFails: "assets.NoAccount" });
    for (let i = 0; i < 5; i++) expect(await redeem(f.deps, req(30 + i))).toMatchObject({ ok: false, status: 502 });
  });

  it("frees the Portal and the signature after a chain refusal, so it can be tried again", async () => {
    const t = setup({ sendFails: "assets.NoAccount" });
    const r = req(7);
    expect(await redeem(t.deps, r)).toMatchObject({ ok: false });
    const t2 = { ...t.deps, send: async (x: { wallet: string; portal: number; note: string }) => ({ txHash: "0xok", block: 1 }) };
    expect(await redeem(t2, r)).toMatchObject({ ok: true, txHash: "0xok" });
    expect(await t.kv.get(burnedKey)).toBe("100");
  });

  it("keeps the locks after a timeout so nothing is sent twice", async () => {
    const t = setup({ sendFails: "Send timed out waiting for a block." });
    const r = req(7);
    expect(await redeem(t.deps, r)).toMatchObject({ ok: false, status: 504 });
    expect(await redeem(t.deps, req(7, {}, "0x" + "b".repeat(40)))).toMatchObject({ ok: false, status: 409 });
  });
});

describe("batch builders", () => {
  const log: string[] = [];
  const api: ShardBatchApi = {
    tx: {
      nfts: { mint: (_c, id) => (log.push(`mint:${id}`), 0), setAttribute: (_c, _i, _n, k) => (log.push(`attr:${k}`), 0) },
      assets: {
        mint: (_i, to, n) => (log.push(`shard:${to}:${n}`), 0),
        forceTransfer: (_i, from, to, n) => (log.push(`take:${from}>${to}:${n}`), 0),
        burn: (_i, who, n) => (log.push(`burn:${who}:${n}`), 0),
      },
      system: { remarkWithEvent: (r) => (log.push(`note:${r}`), 0) },
      utility: { batchAll: (calls) => ({ calls }) },
    },
  };
  const portal = { collection: 25, id: 5, recipient: "p", attributes: [{ key: "name", value: "x" }] };

  it("redeem takes, burns, mints, writes traits, notes - in that order", () => {
    log.length = 0;
    redeemCalls(api, { assetId: 5555, player: "p", issuer: "i", portal, note: "n" });
    expect(log).toEqual(["take:p>i:100", "burn:i:100", "mint:5", "attr:name", "note:n"]);
  });
  it("redeem is a single batch", () => {
    expect((redeemBatch(api, { assetId: 5555, player: "p", issuer: "i", portal, note: "n" }) as { calls: unknown[] }).calls).toHaveLength(5);
  });
  it("award on a normal day has no Portal step; founding day mints first", () => {
    log.length = 0;
    awardCalls(api, { assetId: 5555, payouts: [{ account: "a", amount: 10n, note: "n1" }, { account: "b", amount: 4n, note: "n2" }] });
    expect(log).toEqual(["shard:a:10", "shard:b:4", "note:n1", "note:n2"]);
    log.length = 0;
    awardCalls(api, { assetId: 5555, payouts: [{ account: "a", amount: 10n, note: "n1" }], portal, portalNote: "f" });
    expect(log).toEqual(["mint:5", "attr:name", "shard:a:10", "note:n1", "note:f"]);
  });
  it("refuses an empty award, a zero payout and a Portal outside 1 to 500", () => {
    expect(() => awardCalls(api, { assetId: 1, payouts: [] })).toThrow();
    expect(() => awardCalls(api, { assetId: 1, payouts: [{ account: "a", amount: 0n, note: "n" }] })).toThrow();
    expect(() => redeemCalls(api, { assetId: 1, player: "p", issuer: "i", portal: { ...portal, id: 501 }, note: "n" })).toThrow();
  });
});

describe("message", () => {
  it("names the Portal, the price and the time", () => {
    expect(redeemMessage(7, 123)).toContain("Portal #7");
    expect(redeemMessage(7, 123)).toContain("100 SHARD");
    expect(redeemMessage(7, 123)).toContain("123");
  });
});
