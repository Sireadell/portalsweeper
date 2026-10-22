import { describe, expect, it } from "vitest";
import { generateBoard, saltCommit, TIER_TABLE, coreStrength, frameGivesShield } from "./engine";
import type { PortalMeta } from "./types";

const TIERS = Object.keys(TIER_TABLE);
const CORES = ["Prism", "Starlight", "Solar", "Glow", "Pulse", "Shimmer", "Dim", "Static", "Fractured", "Smoke"];
const FRAMES = ["Stone Frame", "Iron Frame", "Brass Frame", "Obsidian Frame", "Vines", "Rope", "None"];
const SIGILS = [undefined, "None", "Rune", "Eye", "Star", "Moon", "Spark"];

export function fakePortal(id: number, tier = "Common", core?: string, frame?: string, sigil?: string): PortalMeta {
  const traits = [{ trait_type: "Tier", value: tier }, { trait_type: "Gate", value: "Ring" }];
  if (core) traits.push({ trait_type: "Core", value: core });
  if (frame) traits.push({ trait_type: "Frame", value: frame });
  if (sigil) traits.push({ trait_type: "Sigil", value: sigil });
  return { id, name: `Portal #${id}`, image: "/portals/1.webp", traits };
}

// Pseudo random Portal from its id, deterministic so tests are stable.
export function randomPortal(id: number): PortalMeta {
  const pick = <T,>(a: T[], k: number) => a[(id * 2654435761 + k * 40503) % a.length >>> 0];
  return fakePortal(id, pick(TIERS, 1), pick(CORES, 2), pick(FRAMES, 3), pick(SIGILS, 4));
}

describe("saltCommit", () => {
  it("is a 32 byte keccak hash and stable", () => {
    expect(saltCommit("abc")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(saltCommit("abc")).toBe(saltCommit("abc"));
    expect(saltCommit("abc")).not.toBe(saltCommit("abd"));
  });
});

describe("determinism", () => {
  it("same inputs give the same board byte for byte", () => {
    const m = randomPortal(77);
    const a = JSON.stringify(generateBoard(m, "2026-10-20", "salt"));
    const b = JSON.stringify(generateBoard(m, "2026-10-20", "salt"));
    expect(a).toBe(b);
  });
  it("changing token, date or salt changes the mines", () => {
    const m = fakePortal(5, "Epic");
    const base = JSON.stringify(generateBoard(m, "2026-10-20", "s").cells);
    expect(JSON.stringify(generateBoard(fakePortal(6, "Epic"), "2026-10-20", "s").cells)).not.toBe(base);
    expect(JSON.stringify(generateBoard(m, "2026-10-21", "s").cells)).not.toBe(base);
    expect(JSON.stringify(generateBoard(m, "2026-10-20", "t").cells)).not.toBe(base);
  });
  it("rejects a bad date", () => {
    expect(() => generateBoard(fakePortal(1), "20-10-2026", "s")).toThrow();
  });
});

describe("Tier rule", () => {
  it.each(TIERS)("%s sets size and mine count", (tier) => {
    const b = generateBoard(fakePortal(3, tier), "2026-10-20", "s");
    const t = TIER_TABLE[tier];
    expect([b.cols, b.rows, b.mines]).toEqual([t.cols, t.rows, t.mines]);
    expect(b.cells.length).toBe(t.cols * t.rows);
    expect(b.cells.filter((c) => c.mine).length).toBe(t.mines);
    expect(b.rules[0].id).toBe("tier-size");
    expect(b.rules[0].why.length).toBeGreaterThan(10);
  });
  it("unknown tier falls back to Common", () => {
    const b = generateBoard(fakePortal(3, "Mythic"), "2026-10-20", "s");
    expect(b.cols).toBe(TIER_TABLE.Common.cols);
  });
});

describe("Core rule", () => {
  it("a soft core gives a safe free peek", () => {
    for (let id = 1; id <= 30; id++) {
      const b = generateBoard(fakePortal(id, "Uncommon", "Pulse"), "2026-10-20", "s");
      expect(b.freePeek).toBeDefined();
      expect(b.cells[b.freePeek as number].mine).toBe(false);
      expect(b.rules.some((r) => r.id === "core-peek")).toBe(true);
    }
  });
  it("a blazing core picks an open (zero) cell", () => {
    const b = generateBoard(fakePortal(9, "Common", "Prism"), "2026-10-20", "s");
    expect(b.cells[b.freePeek as number].adj).toBe(0);
  });
  it("weak cores give nothing", () => {
    for (const e of ["Dim", "Static", "Fractured", "Smoke"]) {
      expect(coreStrength(e)).toBe("none");
      const b = generateBoard(fakePortal(9, "Common", e), "2026-10-20", "s");
      expect(b.freePeek).toBeUndefined();
    }
  });
});

describe("Sigil rule", () => {
  it("pre-flags one real mine", () => {
    for (let id = 1; id <= 30; id++) {
      const b = generateBoard(fakePortal(id, "Common", undefined, undefined, "Moon"), "2026-10-20", "s");
      expect(b.freeFlag).toBeDefined();
      expect(b.cells[b.freeFlag as number].mine).toBe(true);
      expect(b.rules.some((r) => r.id === "sigil-flag")).toBe(true);
    }
  });
  it("no sigil means no flag", () => {
    expect(generateBoard(fakePortal(1), "2026-10-20", "s").freeFlag).toBeUndefined();
    expect(generateBoard(fakePortal(1, "Common", undefined, undefined, "None"), "2026-10-20", "s").freeFlag).toBeUndefined();
  });
});

describe("Frame rule", () => {
  it("a solid frame gives one shield, a weak or missing frame none", () => {
    for (const h of ["Stone Frame", "Iron Frame", "Brass Frame", "Obsidian Frame"]) {
      expect(frameGivesShield(h)).toBe(true);
      expect(generateBoard(fakePortal(1, "Common", undefined, h), "2026-10-20", "s").shields).toBe(1);
    }
    for (const h of ["Vines", "Rope", "None"]) {
      expect(frameGivesShield(h)).toBe(false);
      expect(generateBoard(fakePortal(1, "Common", undefined, h), "2026-10-20", "s").shields).toBe(0);
    }
  });
});

describe("fairness across 200 Portals", () => {
  it("density 12 to 20 percent, at most 4 rules, an opening exists, safe peek", () => {
    for (let id = 1; id <= 200; id++) {
      const b = generateBoard(randomPortal(id), "2026-10-20", `salt-${id}`);
      const total = b.cols * b.rows;
      const mines = b.cells.filter((c) => c.mine).length;
      expect(mines).toBe(b.mines);
      expect(mines / total).toBeGreaterThanOrEqual(0.12);
      expect(mines / total).toBeLessThanOrEqual(0.2);
      expect(b.rules.length).toBeLessThanOrEqual(4);
      expect(b.cells.some((c) => !c.mine && c.adj === 0)).toBe(true);
      if (b.freePeek !== undefined) expect(b.cells[b.freePeek].mine).toBe(false);
      for (const r of b.rules) expect(r.why.length).toBeGreaterThan(10);
    }
  });
  it("adjacency numbers are correct", () => {
    const b = generateBoard(fakePortal(11, "Epic"), "2026-10-20", "s");
    b.cells.forEach((c, i) => {
      let n = 0;
      const x = i % b.cols;
      const y = Math.floor(i / b.cols);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < b.cols && ny < b.rows && b.cells[ny * b.cols + nx].mine) n++;
        }
      expect(c.adj).toBe(n);
    });
  });
});

describe("all 500 real Portals", () => {
  it("generate without error, with sane coverage", async () => {
    const { readFileSync } = await import("node:fs");
    const all = JSON.parse(readFileSync("data/portals.json", "utf8")) as PortalMeta[];
    expect(all.length).toBe(500);
    let peek = 0, flag = 0, shield = 0, dmin = 1, dmax = 0;
    const sizes: Record<string, number> = {};
    for (const m of all) {
      const b = generateBoard(m, "2026-10-20", "coverage-salt");
      expect(JSON.stringify(generateBoard(m, "2026-10-20", "coverage-salt"))).toBe(JSON.stringify(b));
      const d = b.mines / (b.cols * b.rows);
      dmin = Math.min(dmin, d);
      dmax = Math.max(dmax, d);
      if (b.freePeek !== undefined) peek++;
      if (b.freeFlag !== undefined) flag++;
      if (b.shields) shield++;
      expect(b.rules.length).toBeLessThanOrEqual(4);
      const k = `${b.cols}x${b.rows}`;
      sizes[k] = (sizes[k] ?? 0) + 1;
    }
    console.log({ peek, flag, shield, dmin, dmax, sizes });
    expect(dmin).toBeGreaterThanOrEqual(0.12);
    expect(dmax).toBeLessThanOrEqual(0.2);
    expect(peek / 500).toBeGreaterThan(0.25);
    expect(peek / 500).toBeLessThan(0.6);
    expect(shield / 500).toBeGreaterThan(0.25);
    expect(shield / 500).toBeLessThan(0.6);
  });
});
