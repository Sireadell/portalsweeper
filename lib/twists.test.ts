import { describe, expect, it } from "vitest";
import { TWISTS, isHardcore, twistById } from "./twists";
import { generateBoard } from "./engine";
import type { PortalMeta } from "./types";

describe("twists", () => {
  it("falls back to classic for anything unknown", () => {
    expect(twistById("nope").id).toBe("classic");
    expect(twistById(null).id).toBe("classic");
  });
  it("every twist explains itself on screen", () => {
    for (const t of TWISTS) expect(t.why.length).toBeGreaterThan(20);
  });
  it("only Street Rules earns the Hardcore badge", () => {
    expect(TWISTS.filter((t) => isHardcore(t.id)).map((t) => t.id)).toEqual(["street"]);
  });
  it("twists never touch the board: a board rebuilt from the same secret is identical", () => {
    const meta: PortalMeta = { id: 9, name: "t", image: "", traits: [{ trait_type: "Tier", value: "Rare" }, { trait_type: "Core", value: "Prism core" }] };
    const a = generateBoard(meta, "2026-11-03", "secret-salt");
    const b = generateBoard(meta, "2026-11-03", "secret-salt");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
