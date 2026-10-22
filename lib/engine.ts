// Potsweeper board engine. Fully deterministic: keccak256 and integer maths only.
import { encodePacked, keccak256, toBytes } from "viem";
import type { Board, Cell, PotMeta, FiredRule } from "./types";

// ---------------------------------------------------------------------------
// TRAIT RULE TABLE. The one place that maps Pot trait values to rules.
// Values come from scripts/gen-pots.mjs; any unknown Tier falls back to Common.
// All sizes keep mine density between 12 and 20 percent.
// ---------------------------------------------------------------------------
export const TIER_TABLE: Record<string, { cols: number; rows: number; mines: number }> = {
  Common: { cols: 8, rows: 8, mines: 10 }, // 15.6%
  Uncommon: { cols: 9, rows: 9, mines: 13 }, // 16.0%
  Rare: { cols: 10, rows: 10, mines: 16 }, // 16.0%
  Epic: { cols: 12, rows: 12, mines: 22 }, // 15.3%
  Legendary: { cols: 14, rows: 14, mines: 30 }, // 15.3%
};
export const DEFAULT_TIER = "Common";

// Glaze: a reflective glaze (mirror, crystal, gold leaf) gives a wide peek (the safe cell and
// its neighbours are kept mine free). A soft shine (gloss, pearl, satin) gives a plain peek.
// Dull glazes (matte, raw, crackle, ash) give nothing. About 26 percent of Pots get a wide
// peek and about 54 percent get some peek.
export const GLAZE_WIDE = /(mirror|crystal|gold leaf)/i;
export const GLAZE_PLAIN = /(gloss|pearl|satin)/i;

// Lid: a solid lid (clay, iron, brass, stone) takes one hit. Cork, cloth or no lid is too weak.
export const LID_SOLID = /\b(clay|iron|brass|stone) lid\b/i;

// Charm: any charm pre-flags one real mine. "None" means no charm, no rule.

export type PeekStrength = "none" | "plain" | "wide";
export function glazeStrength(value: string): PeekStrength {
  if (GLAZE_WIDE.test(value)) return "wide";
  if (GLAZE_PLAIN.test(value)) return "plain";
  return "none";
}
export function lidGivesShield(value: string): boolean {
  return LID_SOLID.test(value);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function saltCommit(salt: string): string {
  return keccak256(toBytes(salt));
}

export function neighbors(idx: number, cols: number, rows: number): number[] {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      out.push(ny * cols + nx);
    }
  }
  return out;
}

export function computeCells(mine: boolean[], cols: number, rows: number): Cell[] {
  return mine.map((m, i) => {
    let adj = 0;
    for (const n of neighbors(i, cols, rows)) if (mine[n]) adj++;
    return { mine: m, adj };
  });
}

// Deterministic random stream: keccak256(seed, counter), integers only.
export function rngStream(seed: string) {
  let counter = 0;
  return (bound: number): number => {
    const h = keccak256(encodePacked(["bytes32", "uint256"], [seed as `0x${string}`, BigInt(counter++)]));
    return Number(BigInt(h) % BigInt(bound));
  };
}

// Pick k distinct items from a list (partial Fisher-Yates).
export function pickDistinct(list: number[], k: number, rand: (bound: number) => number): number[] {
  const a = list.slice();
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const j = i + rand(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
    out.push(a[i]);
  }
  return out;
}

function traitValue(meta: PotMeta, name: string): string | undefined {
  const t = meta.traits.find((x) => x.trait_type.toLowerCase() === name.toLowerCase());
  const v = t?.value?.trim();
  return v ? v : undefined;
}

// ---------------------------------------------------------------------------
// generateBoard
// ---------------------------------------------------------------------------
export function generateBoard(meta: PotMeta, date: string, salt: string): Board {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  const seed = keccak256(encodePacked(["uint256", "string", "string"], [BigInt(meta.id), date, salt]));
  const rand = rngStream(seed);

  // Tier sets size and mine count.
  const tierRaw = traitValue(meta, "Tier");
  const tierKey = tierRaw && TIER_TABLE[tierRaw] ? tierRaw : DEFAULT_TIER;
  const { cols, rows, mines } = TIER_TABLE[tierKey];
  const total = cols * rows;
  const rules: FiredRule[] = [
    {
      id: "tier-size",
      trait: "Tier",
      value: tierRaw ?? "none",
      why: tierRaw && TIER_TABLE[tierRaw]
        ? `${tierRaw} Pots get a ${cols} by ${rows} board with ${mines} mines.`
        : `This Pot has no known Tier, so it gets the standard ${cols} by ${rows} board with ${mines} mines.`,
    },
  ];

  // Place mines. The nonce retry makes sure at least one open (zero) area exists.
  const all = Array.from({ length: total }, (_, i) => i);
  let mine: boolean[] = [];
  let cells: Cell[] = [];
  for (let nonce = 0; nonce < 50; nonce++) {
    mine = new Array(total).fill(false);
    for (const i of pickDistinct(all, mines, rand)) mine[i] = true;
    cells = computeCells(mine, cols, rows);
    if (cells.some((c) => !c.mine && c.adj === 0)) break;
  }

  const safeIdx = all.filter((i) => !mine[i]);
  const mineIdx = all.filter((i) => mine[i]);

  // Glaze: one free safe peek.
  let freePeek: number | undefined;
  const glaze = traitValue(meta, "Glaze");
  if (glaze) {
    const s = glazeStrength(glaze);
    if (s !== "none") {
      const zeros = safeIdx.filter((i) => cells[i].adj === 0);
      const pool = s === "wide" && zeros.length > 0 ? zeros : safeIdx;
      freePeek = pool[rand(pool.length)];
      rules.push({
        id: "glaze-peek",
        trait: "Glaze",
        value: glaze,
        why:
          s === "wide"
            ? `The ${glaze} glaze reflects the board: one safe cell is marked for you, and the cells around it are kept clear.`
            : `The ${glaze} glaze catches the light on one safe cell before you start.`,
      });
    }
  }

  // Charm: pre-flag one real mine.
  let freeFlag: number | undefined;
  const charm = traitValue(meta, "Charm");
  if (charm && charm.toLowerCase() !== "none") {
    freeFlag = mineIdx[rand(mineIdx.length)];
    rules.push({
      id: "charm-flag",
      trait: "Charm",
      value: charm,
      why: `The ${charm} charm senses one mine and flags it for you.`,
    });
  }

  // Lid: one shield.
  let shields = 0;
  const lid = traitValue(meta, "Lid");
  if (lid && lidGivesShield(lid)) {
    shields = 1;
    rules.push({
      id: "lid-shield",
      trait: "Lid",
      value: lid,
      why: `The ${lid} is solid: it protects you from one mine.`,
    });
  }

  const board: Board = {
    tokenId: meta.id,
    date,
    cols,
    rows,
    mines,
    cells,
    rules,
    shields,
    commit: saltCommit(salt),
  };
  if (freePeek !== undefined) board.freePeek = freePeek;
  if (freeFlag !== undefined) board.freeFlag = freeFlag;
  return board;
}
