import { describe, it, expect } from "vitest";
import { getOwnedPots, getPotMeta, isPotId } from "./chain";
import { mappedAccount, walletOf } from "./native";

describe("chain", () => {
  it("returns [] for a malformed address without touching the chain", async () => {
    expect(await getOwnedPots("nope")).toEqual([]);
  });

  it("getPotMeta reads the generated collection", async () => {
    const m = await getPotMeta(1);
    expect(m.id).toBe(1);
    expect(m.image).toBe("/pots/1.webp");
    expect(m.traits.map((t) => t.trait_type)).toEqual(["Tier", "Shape", "Clay", "Glaze", "Lid", "Charm", "Pattern", "Background"]);
    await expect(getPotMeta(501)).rejects.toThrow();
  });

  it("checks Pot numbers", () => {
    expect(isPotId(1)).toBe(true);
    expect(isPotId(500)).toBe(true);
    expect(isPotId(0)).toBe(false);
    expect(isPotId(1.5)).toBe(false);
  });

  it("maps an 0x wallet to its Portaldot account and back", () => {
    const w = "0x6ce5b32c1747442ff480dc1ce60a2b229cca0f82";
    const acc = mappedAccount(w);
    expect(acc).toBe("5EXVGFmsXX8Up9Gwes9WHqssDXJHAYZLQzTU341y6SBA8AoM");
    expect(walletOf(acc)).toBe(w);
    expect(walletOf("5GxegAnxmYtA8EQXCCuSy5KTJu7fLsR6THtXpx7bw3P6yeqc")).toBeNull();
    expect(() => mappedAccount("0x12")).toThrow();
  });
});
