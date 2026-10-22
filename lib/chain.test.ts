import { describe, it, expect } from "vitest";
import { getOwnedPortals, getPortalMeta, isPortalId } from "./chain";
import { mappedAccount, walletOf } from "./native";

describe("chain", () => {
  it("returns [] for a malformed address without touching the chain", async () => {
    expect(await getOwnedPortals("nope")).toEqual([]);
  });

  it("getPortalMeta reads the generated collection", async () => {
    const m = await getPortalMeta(1);
    expect(m.id).toBe(1);
    expect(m.image).toBe("/portals/1.webp");
    expect(m.traits.map((t) => t.trait_type)).toEqual(["Tier", "Gate", "Rift", "Core", "Frame", "Sigil", "Pattern", "Realm"]);
    await expect(getPortalMeta(501)).rejects.toThrow();
  });

  it("checks Portal numbers", () => {
    expect(isPortalId(1)).toBe(true);
    expect(isPortalId(500)).toBe(true);
    expect(isPortalId(0)).toBe(false);
    expect(isPortalId(1.5)).toBe(false);
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
