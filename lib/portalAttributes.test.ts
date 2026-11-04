import { describe, expect, it } from "vitest";
import { attributeDeposit, portalAttributes } from "./portalAttributes";

const P = { id: 7, name: "Portal #7", image: "/portals/7.webp", traits: [{ trait_type: "Tier", value: "Common" }, { trait_type: "Gate", value: "Arch" }] };

describe("Portal attributes written on the chain", () => {
  it("writes the name, a full picture link and the traits", () => {
    expect(portalAttributes(P, "https://portalsweeper.vercel.app/")).toEqual([
      { key: "name", value: "Portal #7" },
      { key: "image", value: "https://portalsweeper.vercel.app/portals/7.webp" },
      { key: "traits", value: "Tier:Common,Gate:Arch" },
    ]);
  });
  it("adds up the deposit from the base amount and the bytes", () => {
    expect(attributeDeposit([{ key: "ab", value: "cde" }], 10n, 2n)).toBe(20n);
    expect(attributeDeposit([], 10n, 2n)).toBe(0n);
  });
});
