import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRecordStore } from "./records";
import { portalOfDay } from "./cotd";
import { awardDay, type AwardDeps } from "./award";

const D = "2026-10-20";
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

function setup() {
  const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "award-")), "r.json"));
  const minted = new Map<number, string>();
  const mints: [number, string][] = [];
  let fail = false;
  const deps: AwardDeps = {
    store,
    now: () => 1,
    mint: async (id, wallet) => {
      if (fail) throw new Error("chain down");
      mints.push([id, wallet]);
      minted.set(id, wallet);
      return { txHash: "0xmint", block: 7 };
    },
    ownerOf: async (id) => minted.get(id) ?? null,
  };
  return { store, deps, mints, minted, setFail: (f: boolean) => (fail = f) };
}

async function finish(store: FileRecordStore, wallet: string, tokenId: number, seconds: number, won = true) {
  await store.cotdStart({ date: D, wallet, tokenId, startedAt: 0 });
  await store.cotdFinish(D, wallet, { won, seconds, moves: 10, at: seconds * 1000 });
}

describe("awarding the Portal of the day", () => {
  beforeAll(() => { process.env.PORTAL_SALT_SECRET = "test-secret"; });

  it("mints the Portal to the fastest clear", async () => {
    const t = setup();
    const id = await portalOfDay(t.store, D);
    await finish(t.store, A, id, 40);
    await finish(t.store, B, id, 25);
    const out = await awardDay(t.deps, D);
    expect(out).toMatchObject({ status: "minted", claim: { tokenId: id, wallet: B, date: D, status: "minted", txHash: "0xmint", block: 7 } });
    expect(t.mints).toEqual([[id, B]]);
  });

  it("does nothing when nobody cleared it", async () => {
    const t = setup();
    const id = await portalOfDay(t.store, D);
    await finish(t.store, A, id, 40, false);
    expect(await awardDay(t.deps, D)).toEqual({ status: "no-winner", date: D, tokenId: id });
    expect(t.mints).toEqual([]);
  });

  it("never mints twice when run again", async () => {
    const t = setup();
    const id = await portalOfDay(t.store, D);
    await finish(t.store, A, id, 40);
    await awardDay(t.deps, D);
    expect(await awardDay(t.deps, D)).toMatchObject({ status: "already" });
    expect(t.mints.length).toBe(1);
  });

  it("retries the same winner after a failed mint, and notices a mint that already landed", async () => {
    const t = setup();
    const id = await portalOfDay(t.store, D);
    await finish(t.store, A, id, 40);
    t.setFail(true);
    expect(await awardDay(t.deps, D)).toMatchObject({ status: "failed" });
    expect((await t.store.claimGet(id))?.status).toBe("minting");
    t.setFail(false);
    expect(await awardDay(t.deps, D)).toMatchObject({ status: "minted", claim: { wallet: A } });
    // a mint that reached the chain but was not saved is recognised, not sent again
    await t.store.claimSave({ ...(await t.store.claimGet(id))!, status: "minting" });
    expect(await awardDay(t.deps, D)).toMatchObject({ status: "minted" });
    expect(t.mints.length).toBe(1);
  });
});
