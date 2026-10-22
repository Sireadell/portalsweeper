import { describe, expect, it } from "vitest";
import { generateBoard, saltCommit, TIER_TABLE, glazeStrength, lidGivesShield } from "./engine";
import type { PotMeta } from "./types";

const TIERS = Object.keys(TIER_TABLE);
const GLAZES = ["Mirror", "Crystal", "Gold Leaf", "Gloss", "Pearl", "Satin", "Matte", "Raw", "Crackle", "Ash"];
const LIDS = ["Clay Lid", "Iron Lid", "Brass Lid", "Stone Lid", "Cork", "Cloth Wrap", "None"];
const CHARMS = [undefined, "None", "Beads", "Bell", "Feather", "Cowrie", "Ribbon"];

export function fakePot(id: number, tier = "Common", glaze?: string, lid?: string, charm?: string): PotMeta {
  const traits = [{ trait_type: "Tier", value: tier }, { trait_type: "Shape", value: "Jar" }];
  if (glaze) traits.push({ trait_type: "Glaze", value: glaze });
  if (lid) traits.push({ trait_type: "Lid", value: lid });
  if (charm) traits.push({ trait_type: "Charm", value: charm });
  return { id, name: `Pot #${id}`, image: "/pots/1.webp", traits };
}

// Pseudo random Pot from its id, deterministic so tests are stable.
export function randomPot(id: number): PotMeta {
  const pick = <T,>(a: T[], k: number) => a[(id * 2654435761 + k * 40503) % a.length >>> 0];
  return fakePot(id, pick(TIERS, 1), pick(GLAZES, 2), pick(LIDS, 3), pick(CHARMS, 4));
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
    const m = randomPot(77);
    const a = JSON.stringify(generateBoard(m, "2026-10-20", "salt"));
    const b = JSON.stringify(generateBoard(m, "2026-10-20", "salt"));
    expect(a).toBe(b);
  });
  it("changing token, date or salt changes the mines", () => {
    const m = fakePot(5, "Epic");
    const base = JSON.stringify(generateBoard(m, "2026-10-20", "s").cells);
    expect(JSON.stringify(generateBoard(fakePot(6, "Epic"), "2026-10-20", "s").cells)).not.toBe(base);
    expect(JSON.stringify(generateBoard(m, "2026-10-21", "s").cells)).not.toBe(base);
    expect(JSON.stringify(generateBoard(m, "2026-10-20", "t").cells)).not.toBe(base);
  });
  it("rejects a bad date", () => {
    expect(() => generateBoard(fakePot(1), "20-10-2026", "s")).toThrow();
  });
});

describe("Tier rule", () => {
  it.each(TIERS)("%s sets size and mine count", (tier) => {
    const b = generateBoard(fakePot(3, tier), "2026-10-20", "s");
    const t = TIER_TABLE[tier];
    expect([b.cols, b.rows, b.mines]).toEqual([t.cols, t.rows, t.mines]);
    expect(b.cells.length).toBe(t.cols * t.rows);
    expect(b.cells.filter((c) => c.mine).length).toBe(t.mines);
    expect(b.rules[0].id).toBe("tier-size");
    expect(b.rules[0].why.length).toBeGreaterThan(10);
  });
  it("unknown tier falls back to Common", () => {
    const b = generateBoard(fakePot(3, "Mythic"), "2026-10-20", "s");
    expect(b.cols).toBe(TIER_TABLE.Common.cols);
  });
});

describe("Glaze rule", () => {
  it("a soft shine gives a safe free peek", () => {
    for (let id = 1; id <= 30; id++) {
      const b = generateBoard(fakePot(id, "Uncommon", "Pearl"), "2026-10-20", "s");
      expect(b.freePeek).toBeDefined();
      expect(b.cells[b.freePeek as number].mine).toBe(false);
      expect(b.rules.some((r) => r.id === "glaze-peek")).toBe(true);
    }
  });
  it("a reflective glaze picks an open (zero) cell", () => {
    const b = generateBoard(fakePot(9, "Common", "Mirror"), "2026-10-20", "s");
    expect(b.cells[b.freePeek as number].adj).toBe(0);
  });
  it("dull glazes give nothing", () => {
    for (const e of ["Matte", "Raw", "Crackle", "Ash"]) {
      expect(glazeStrength(e)).toBe("none");
      const b = generateBoard(fakePot(9, "Common", e), "2026-10-20", "s");
      expect(b.freePeek).toBeUndefined();
    }
  });
});

describe("Charm rule", () => {
  it("pre-flags one real mine", () => {
    for (let id = 1; id <= 30; id++) {
      const b = generateBoard(fakePot(id, "Common", undefined, undefined, "Cowrie"), "2026-10-20", "s");
      expect(b.freeFlag).toBeDefined();
      expect(b.cells[b.freeFlag as number].mine).toBe(true);
      expect(b.rules.some((r) => r.id === "charm-flag")).toBe(true);
    }
  });
  it("no charm means no flag", () => {
    expect(generateBoard(fakePot(1), "2026-10-20", "s").freeFlag).toBeUndefined();
    expect(generateBoard(fakePot(1, "Common", undefined, undefined, "None"), "2026-10-20", "s").freeFlag).toBeUndefined();
  });
});

describe("Lid rule", () => {
  it("a solid lid gives one shield, a soft or missing lid none", () => {
    for (const h of ["Clay Lid", "Iron Lid", "Brass Lid", "Stone Lid"]) {
      expect(lidGivesShield(h)).toBe(true);
      expect(generateBoard(fakePot(1, "Common", undefined, h), "2026-10-20", "s").shields).toBe(1);
    }
    for (const h of ["Cork", "Cloth Wrap", "None"]) {
      expect(lidGivesShield(h)).toBe(false);
      expect(generateBoard(fakePot(1, "Common", undefined, h), "2026-10-20", "s").shields).toBe(0);
    }
  });
});

describe("fairness across 200 Pots", () => {
  it("density 12 to 20 percent, at most 4 rules, an opening exists, safe peek", () => {
    for (let id = 1; id <= 200; id++) {
      const b = generateBoard(randomPot(id), "2026-10-20", `salt-${id}`);
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
    const b = generateBoard(fakePot(11, "Epic"), "2026-10-20", "s");
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

describe("all 500 real Pots", () => {
  it("generate without error, with sane coverage", async () => {
    const { readFileSync } = await import("node:fs");
    const all = JSON.parse(readFileSync("data/pots.json", "utf8")) as PotMeta[];
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
