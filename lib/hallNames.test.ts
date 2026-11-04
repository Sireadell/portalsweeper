import { describe, expect, it } from "vitest";
import { hallNames } from "./hallNames";

const A = "0x" + "a".repeat(40);
const B = "0x" + "B".repeat(40);

describe("hallNames", () => {
  it("keeps only wallets that have a name, matched in lower case", async () => {
    const m = await hallNames([A, B, A, "nope"], async (w) => w.map((x) => (x === A ? "Ada" : null)));
    expect([...m.entries()]).toEqual([[A, "Ada"]]);
  });
  it("gives nothing when the chain fails or is too slow", async () => {
    expect((await hallNames([A], async () => { throw new Error("down"); })).size).toBe(0);
    expect((await hallNames([A], () => new Promise(() => {}), 20)).size).toBe(0);
  });
  it("skips the read when there are no wallets", async () => {
    let called = false;
    await hallNames([], async () => { called = true; return []; });
    expect(called).toBe(false);
  });
});
