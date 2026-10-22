// Generates the Portal collection: data/portals.json (traits) and public/portals/<id>.webp (art, 320px).
// Fully deterministic: the same script always draws the same 500 Portals.
// Run: node scripts/gen-portals.mjs [--svg] (--svg also keeps the source SVGs in public/portals/svg for checking)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const SUPPLY = 500;
const keepSvg = process.argv.includes("--svg");

// Small seeded random generator (mulberry32). Seeded per Portal, so changing one Portal never shifts another.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
function weighted(r, table) {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of table) if ((x -= w) < 0) return v;
  return table[table.length - 1][0];
}

// ---------------------------------------------------------------------------
// Trait tables. Core, Frame and Sigil change the game rules (see lib/engine.ts).
// ---------------------------------------------------------------------------
const TIERS = [["Common", 65], ["Uncommon", 26], ["Rare", 5], ["Epic", 3], ["Legendary", 1]];
const GATES = ["Ring", "Arch", "Oval", "Hexagon", "Diamond", "Keyhole", "Octagon", "Doorway"];
// Rift colours: [bright centre, mid, dark edge]
const RIFTS = {
  Violet: ["#f0dcff", "#9b5cff", "#2a0f5c"], Cyan: ["#e0fdff", "#25c6e8", "#06324a"], Magenta: ["#ffe0f6", "#e83fb4", "#4a0838"],
  Emerald: ["#e2ffe9", "#2fd17a", "#063d24"], Amber: ["#fff4d6", "#ffab2e", "#4f2400"], Crimson: ["#ffe0e0", "#ff4b4b", "#4a0710"],
  Ice: ["#ffffff", "#9fd8ff", "#1b3d66"], Gold: ["#fffbe0", "#ffd23a", "#5a3d00"], Void: ["#d9d4ff", "#4b3aa8", "#05030f"],
};
const CORES = [["Prism", 9], ["Starlight", 9], ["Solar", 7], ["Glow", 11], ["Pulse", 10], ["Shimmer", 7], ["Dim", 18], ["Static", 13], ["Fractured", 11], ["Smoke", 5]];
const FRAMES = [["Stone Frame", 18], ["Iron Frame", 14], ["Brass Frame", 12], ["Obsidian Frame", 12], ["Vines", 14], ["Rope", 12], ["None", 18]];
const SIGILS = [["None", 88], ["Rune", 3], ["Eye", 2.5], ["Star", 2], ["Moon", 2.5], ["Spark", 2]];
const PATTERNS = ["Plain", "Stripes", "Zigzag", "Dots", "Waves", "Adire", "Kente", "Runes"];
const REALMS = {
  Nebula: ["#2b1452", "#0d0a24"], Ocean: ["#0f4c6e", "#061a2b"], Dusk: ["#ff9e7a", "#4b2a6b"],
  Desert: ["#f4d58d", "#b9773e"], Forest: ["#2f6b45", "#0c2416"], Night: ["#1c2350", "#05071a"],
  Ember: ["#7a1f1f", "#1a0505"], Glacier: ["#d6f0ff", "#6aa3d6"], Dawn: ["#ffe2b0", "#f08aa0"],
};
const DARK_REALMS = new Set(["Nebula", "Ocean", "Forest", "Night", "Ember"]);

const CX = 256, CY = 262, INNER = 0.7;
const OUT = "#120a1c";
const f = (n) => n.toFixed(1);
const poly = (n, rad, rot = 0, sy = 1) =>
  "M " + Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return `${f(CX + rad * Math.cos(a))} ${f(CY + rad * Math.sin(a) * sy)}`;
  }).join(" L ") + " Z";

// Outer outline of each gate (the frame). The opening is the same outline scaled by INNER.
// top: the y of the gate's top edge, where the Sigil sits.
const GATE_SHAPES = {
  Ring: { d: `M ${CX - 180} ${CY} A 180 180 0 1 1 ${CX + 180} ${CY} A 180 180 0 1 1 ${CX - 180} ${CY} Z`, top: CY - 180 },
  Oval: { d: `M ${CX - 140} ${CY} A 140 190 0 1 1 ${CX + 140} ${CY} A 140 190 0 1 1 ${CX - 140} ${CY} Z`, top: CY - 190 },
  Arch: { d: `M ${CX - 150} ${CY + 190} L ${CX - 150} ${CY - 40} A 150 150 0 0 1 ${CX + 150} ${CY - 40} L ${CX + 150} ${CY + 190} Z`, top: CY - 190 },
  Hexagon: { d: poly(6, 190, -Math.PI / 2), top: CY - 190 },
  Octagon: { d: poly(8, 190, -Math.PI / 2 + Math.PI / 8), top: CY - 176 },
  Diamond: { d: poly(4, 195, -Math.PI / 2), top: CY - 195 },
  Keyhole: (() => {
    const R = 120, cy = CY - 70, hw = 60, yj = cy + Math.sqrt(R * R - hw * hw), yb = CY + 190;
    return { d: `M ${CX - 110} ${yb} L ${CX - hw} ${f(yj)} A ${R} ${R} 0 1 1 ${CX + hw} ${f(yj)} L ${CX + 110} ${yb} Z`, top: cy - R };
  })(),
  Doorway: { d: `M ${CX - 135} ${CY + 190} L ${CX - 135} ${CY - 150} Q ${CX - 135} ${CY - 190} ${CX - 95} ${CY - 190} L ${CX + 95} ${CY - 190} Q ${CX + 135} ${CY - 190} ${CX + 135} ${CY - 150} L ${CX + 135} ${CY + 190} Z`, top: CY - 190 },
};
const innerT = `transform="translate(${CX} ${CY}) scale(${INNER}) translate(${-CX} ${-CY})"`;

// Frame materials: [fill, light edge, dark edge]
const MATERIAL = {
  "Stone Frame": ["#9a958c", "#c9c4b9", "#5f5b54"], "Iron Frame": ["#5d636d", "#9aa1ab", "#30343a"],
  "Brass Frame": ["#d9a62e", "#ffe08a", "#8a6110"], "Obsidian Frame": ["#1d1626", "#7d5cc4", "#07050b"],
  Vines: ["#3f7a3a", "#7fc06b", "#1f4220"], Rope: ["#c49a5e", "#ead0a2", "#7d5a2e"], None: ["#000000", "#ffffff", "#000000"],
};

function patternSvg(kind, r, light, dark) {
  const band = (y, h, fill) => `<rect x="0" y="${y}" width="512" height="${h}" fill="${fill}"/>`;
  switch (kind) {
    case "Stripes": {
      let s = "";
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12;
        s += `<path d="M ${CX} ${CY} L ${f(CX + 300 * Math.cos(a))} ${f(CY + 300 * Math.sin(a))}" stroke="${dark}" stroke-width="7"/>`;
      }
      return s;
    }
    case "Zigzag": {
      let s = "";
      for (let y = 40; y < 480; y += 36) {
        let d = `M 0 ${y}`;
        for (let x = 0; x <= 512; x += 24) d += ` L ${x + 12} ${y - 12} L ${x + 24} ${y}`;
        s += `<path d="${d}" fill="none" stroke="${light}" stroke-width="5" opacity="0.7"/>`;
      }
      return s;
    }
    case "Dots": {
      let s = "";
      for (let y = 40; y < 480; y += 26)
        for (let x = 30 + ((y / 26) % 2) * 13; x < 490; x += 26) s += `<circle cx="${x}" cy="${y}" r="4.5" fill="${light}" opacity="0.8"/>`;
      return s;
    }
    case "Waves": {
      let s = "";
      for (let k = 1; k <= 6; k++) s += `<circle cx="${CX}" cy="${CY}" r="${110 + k * 16}" fill="none" stroke="${k % 2 ? light : dark}" stroke-width="5" opacity="0.75"/>`;
      return s;
    }
    case "Adire": {
      // Indigo resist-dye style: a grid of circles and crosses.
      let s = band(0, 512, "#2b3a78");
      for (let y = 30; y < 500; y += 40)
        for (let x = 30; x < 500; x += 40)
          s += (Math.floor(x / 40) + Math.floor(y / 40)) % 2
            ? `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="#c9d4ff" stroke-width="4"/>`
            : `<path d="M ${x - 9} ${y} h 18 M ${x} ${y - 9} v 18" stroke="#c9d4ff" stroke-width="4"/>`;
      return s;
    }
    case "Kente": {
      const cols = ["#f2c230", "#1f8a4c", "#d0352b", "#111111"];
      let s = "";
      for (let y = 40, i = 0; y < 480; y += 22, i++)
        for (let x = 30, j = 0; x < 490; x += 28, j++) s += `<rect x="${x}" y="${y}" width="28" height="22" fill="${cols[(i + j + Math.floor(r() * 2)) % 4]}"/>`;
      return s;
    }
    case "Runes": {
      let s = "";
      const glyphs = ["M -7 -9 L 0 9 L 7 -9", "M -7 9 L -7 -9 L 7 0 L -7 9", "M 0 -9 L 0 9 M -7 -3 L 7 3", "M -7 -9 L 7 9 M 7 -9 L -7 9", "M -6 9 L -6 -9 L 6 -4 L -6 1"];
      for (let i = 0; i < 20; i++) {
        const a = (i * Math.PI) / 10;
        const x = CX + 158 * Math.cos(a), y = CY + 158 * Math.sin(a);
        s += `<path d="${glyphs[Math.floor(r() * glyphs.length)]}" transform="translate(${f(x)} ${f(y)})" fill="none" stroke="${light}" stroke-width="3.5" stroke-linecap="round"/>`;
      }
      return s;
    }
    default:
      return "";
  }
}

// The swirling rift inside the opening.
function riftSvg(r, rift) {
  let s = `<rect width="512" height="512" fill="url(#rift)"/>`;
  const arms = 3 + Math.floor(r() * 3);
  const spin = r() * Math.PI * 2;
  for (let k = 0; k < arms; k++) {
    let d = "";
    for (let t = 0; t <= 60; t++) {
      const th = spin + (k * 2 * Math.PI) / arms + t * 0.09;
      const rad = 6 + t * 3.2;
      d += `${t ? " L" : "M"} ${f(CX + rad * Math.cos(th))} ${f(CY + rad * Math.sin(th))}`;
    }
    s += `<path d="${d}" fill="none" stroke="${rift[0]}" stroke-width="${7 - k * 0.6}" stroke-linecap="round" opacity="0.45"/>`;
  }
  for (let i = 0; i < 18; i++) s += `<circle cx="${f(CX + (r() - 0.5) * 260)}" cy="${f(CY + (r() - 0.5) * 300)}" r="${f(1 + r() * 2.2)}" fill="#fff" opacity="${f(0.3 + r() * 0.6)}"/>`;
  return s;
}

function coreSvg(kind, r, rift) {
  const star = (x, y, k, fill, op = 1) =>
    `<path d="M ${f(x)} ${f(y - k)} Q ${f(x)} ${f(y)} ${f(x + k)} ${f(y)} Q ${f(x)} ${f(y)} ${f(x)} ${f(y + k)} Q ${f(x)} ${f(y)} ${f(x - k)} ${f(y)} Q ${f(x)} ${f(y)} ${f(x)} ${f(y - k)} Z" fill="${fill}" opacity="${op}"/>`;
  switch (kind) {
    case "Prism": {
      const cols = ["#ff5a5a", "#ffb23a", "#fff35a", "#4fe07a", "#4fb8ff", "#9b6bff"];
      let s = "";
      cols.forEach((c, i) => {
        const a = (i * Math.PI) / 3 + 0.3;
        s += `<path d="M ${CX} ${CY} L ${f(CX + 200 * Math.cos(a - 0.12))} ${f(CY + 200 * Math.sin(a - 0.12))} L ${f(CX + 200 * Math.cos(a + 0.12))} ${f(CY + 200 * Math.sin(a + 0.12))} Z" fill="${c}" opacity="0.55"/>`;
      });
      return s + `<circle cx="${CX}" cy="${CY}" r="34" fill="#fff"/><path d="M ${CX} ${CY - 22} L ${CX + 18} ${CY + 14} L ${CX - 18} ${CY + 14} Z" fill="none" stroke="${rift[1]}" stroke-width="4"/>`;
    }
    case "Starlight": {
      let s = `<circle cx="${CX}" cy="${CY}" r="40" fill="#fff" opacity="0.8"/>` + star(CX, CY, 46, "#fff");
      for (let i = 0; i < 9; i++) s += star(CX + (r() - 0.5) * 220, CY + (r() - 0.5) * 260, 6 + r() * 10, "#fff", 0.9);
      return s;
    }
    case "Solar": {
      let s = "";
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        s += `<path d="M ${f(CX + 40 * Math.cos(a))} ${f(CY + 40 * Math.sin(a))} L ${f(CX + 95 * Math.cos(a))} ${f(CY + 95 * Math.sin(a))}" stroke="#ffe066" stroke-width="7" stroke-linecap="round"/>`;
      }
      return s + `<circle cx="${CX}" cy="${CY}" r="46" fill="#ffd23a" stroke="#fff6c2" stroke-width="6"/><circle cx="${CX}" cy="${CY}" r="26" fill="#fffbe0"/>`;
    }
    case "Glow":
      return `<circle cx="${CX}" cy="${CY}" r="70" fill="${rift[0]}" opacity="0.35"/><circle cx="${CX}" cy="${CY}" r="36" fill="#fff" opacity="0.85"/>`;
    case "Pulse":
      return [80, 60, 40].map((rad, i) => `<circle cx="${CX}" cy="${CY}" r="${rad}" fill="none" stroke="#fff" stroke-width="${3 + i}" opacity="${0.35 + i * 0.2}"/>`).join("") + `<circle cx="${CX}" cy="${CY}" r="20" fill="#fff"/>`;
    case "Shimmer": {
      let s = `<circle cx="${CX}" cy="${CY}" r="30" fill="#fff" opacity="0.75"/>`;
      for (let i = 0; i < 6; i++) {
        const y = CY - 90 + i * 36;
        s += `<path d="M ${f(CX - 60 - r() * 30)} ${y} L ${f(CX + 60 + r() * 30)} ${y - 14}" stroke="#fff" stroke-width="3" opacity="0.5" stroke-linecap="round"/>`;
      }
      return s;
    }
    case "Dim":
      return `<circle cx="${CX}" cy="${CY}" r="18" fill="${rift[0]}" opacity="0.5"/>`;
    case "Static": {
      let s = `<circle cx="${CX}" cy="${CY}" r="22" fill="#ddd" opacity="0.55"/>`;
      for (let i = 0; i < 70; i++) s += `<rect x="${f(CX + (r() - 0.5) * 230)}" y="${f(CY + (r() - 0.5) * 280)}" width="3" height="3" fill="${r() < 0.5 ? "#fff" : "#000"}" opacity="0.55"/>`;
      return s;
    }
    case "Fractured": {
      let s = `<circle cx="${CX}" cy="${CY}" r="24" fill="${rift[0]}" opacity="0.6"/>`;
      for (let i = 0; i < 7; i++) {
        let x = CX, y = CY, d = `M ${x} ${y}`;
        const a = r() * Math.PI * 2;
        for (let k = 0; k < 4; k++) { x += Math.cos(a + (r() - 0.5)) * 30; y += Math.sin(a + (r() - 0.5)) * 30; d += ` L ${f(x)} ${f(y)}`; }
        s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.8"/>`;
      }
      return s;
    }
    case "Smoke": {
      let s = "";
      for (let i = 0; i < 7; i++) s += `<circle cx="${f(CX + (r() - 0.5) * 120)}" cy="${f(CY + (r() - 0.5) * 140)}" r="${f(30 + r() * 40)}" fill="#8a8a96" opacity="0.28"/>`;
      return s;
    }
    default:
      return "";
  }
}

function frameExtras(kind, d, r) {
  if (kind === "Vines") {
    let s = `<path d="${d}" fill="none" stroke="#2a5a26" stroke-width="10" stroke-dasharray="18 10"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 + r() * 0.3, rad = 160 + r() * 20;
      const x = CX + rad * Math.cos(a), y = CY + rad * Math.sin(a) * 1.05;
      s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="11" ry="6" transform="rotate(${f((a * 180) / Math.PI + 45)} ${f(x)} ${f(y)})" fill="#7fc06b" stroke="${OUT}" stroke-width="2"/>`;
    }
    return s;
  }
  if (kind === "Rope") return `<path d="${d}" fill="none" stroke="#7d5a2e" stroke-width="6" stroke-dasharray="6 9" transform="translate(${CX} ${CY}) scale(0.85) translate(${-CX} ${-CY})"/>`;
  if (kind === "Iron Frame") {
    let s = "";
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      s += `<circle cx="${f(CX + 158 * Math.cos(a))}" cy="${f(CY + 158 * Math.sin(a))}" r="5" fill="#9aa1ab" stroke="${OUT}" stroke-width="2"/>`;
    }
    return s;
  }
  if (kind === "Stone Frame") {
    let s = "";
    for (let i = 0; i < 14; i++) {
      const a = (i * Math.PI) / 7;
      s += `<path d="M ${f(CX + 140 * Math.cos(a))} ${f(CY + 140 * Math.sin(a))} L ${f(CX + 200 * Math.cos(a))} ${f(CY + 200 * Math.sin(a))}" stroke="#5f5b54" stroke-width="3"/>`;
    }
    return s;
  }
  return "";
}

function sigilSvg(kind, top) {
  if (kind === "None") return "";
  const x = CX, y = top + 4;
  const badge = `<circle cx="${x}" cy="${y}" r="27" fill="#1a1030" stroke="#ffe08a" stroke-width="5"/>`;
  const c = "#ffe08a";
  switch (kind) {
    case "Rune":
      return badge + `<path d="M ${x - 8} ${y + 13} L ${x - 8} ${y - 13} L ${x + 9} ${y - 3} L ${x - 8} ${y + 4}" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`;
    case "Eye":
      return badge + `<path d="M ${x - 17} ${y} Q ${x} ${y - 15} ${x + 17} ${y} Q ${x} ${y + 15} ${x - 17} ${y} Z" fill="none" stroke="${c}" stroke-width="3.5"/><circle cx="${x}" cy="${y}" r="5" fill="${c}"/>`;
    case "Star":
      return badge + `<path d="${Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? 7 : 16;
        return `${i ? "L" : "M"} ${f(x + rad * Math.cos(a))} ${f(y + rad * Math.sin(a))}`;
      }).join(" ")} Z" fill="${c}"/>`;
    case "Moon":
      return badge + `<path d="M ${x + 4} ${y - 15} A 15 15 0 1 0 ${x + 4} ${y + 15} A 11 11 0 1 1 ${x + 4} ${y - 15} Z" fill="${c}"/>`;
    case "Spark":
      return badge + `<path d="M ${x + 3} ${y - 16} L ${x - 9} ${y + 2} L ${x} ${y + 2} L ${x - 3} ${y + 16} L ${x + 9} ${y - 2} L ${x} ${y - 2} Z" fill="${c}"/>`;
    default:
      return "";
  }
}

function tierSvg(tier, r) {
  if (tier === "Legendary" || tier === "Epic") {
    let s = `<circle cx="${CX}" cy="${CY}" r="236" fill="url(#aura)" opacity="${tier === "Legendary" ? 0.9 : 0.5}"/>`;
    const n = tier === "Legendary" ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const x = 30 + r() * 452, y = 24 + r() * 120, k = 6 + r() * 8;
      s += `<path d="M ${f(x)} ${f(y - k)} Q ${f(x)} ${f(y)} ${f(x + k)} ${f(y)} Q ${f(x)} ${f(y)} ${f(x)} ${f(y + k)} Q ${f(x)} ${f(y)} ${f(x - k)} ${f(y)} Q ${f(x)} ${f(y)} ${f(x)} ${f(y - k)} Z" fill="#fff"/>`;
    }
    return s;
  }
  if (tier === "Rare") return `<circle cx="${CX}" cy="${CY}" r="226" fill="url(#aura)" opacity="0.3"/>`;
  return "";
}

export function makePortal(id) {
  // Same seed and the same order of draws as the first version, so tiers and rule counts stay put.
  const r = rng(id * 7919 + 20261022);
  const tier = weighted(r, TIERS);
  const gate = pick(r, GATES);
  const riftName = pick(r, Object.keys(RIFTS));
  const core = weighted(r, CORES);
  const frame = weighted(r, FRAMES);
  const sigil = weighted(r, SIGILS);
  const pattern = pick(r, PATTERNS);
  const realmName = pick(r, Object.keys(REALMS));
  const traits = [
    { trait_type: "Tier", value: tier },
    { trait_type: "Gate", value: gate },
    { trait_type: "Rift", value: riftName },
    { trait_type: "Core", value: core },
    { trait_type: "Frame", value: frame },
    { trait_type: "Sigil", value: sigil },
    { trait_type: "Pattern", value: pattern },
    { trait_type: "Realm", value: realmName },
  ];
  const rift = RIFTS[riftName];
  const realm = REALMS[realmName];
  const { d, top } = GATE_SHAPES[gate];
  const mat = MATERIAL[frame];
  const noFrame = frame === "None";
  // With no frame, the band is just the rift's own colour, glowing at the edge.
  const bandFill = noFrame ? rift[2] : mat[0];

  const realmStars = DARK_REALMS.has(realmName)
    ? Array.from({ length: 40 }, () => `<circle cx="${f(r() * 512)}" cy="${f(r() * 512)}" r="${f(0.6 + r() * 1.6)}" fill="#fff" opacity="${f(0.3 + r() * 0.6)}"/>`).join("")
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${realm[0]}"/><stop offset="1" stop-color="${realm[1]}"/></linearGradient>
<radialGradient id="rift" cx="${CX}" cy="${CY}" r="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rift[0]}"/><stop offset="0.35" stop-color="${rift[1]}"/><stop offset="1" stop-color="${rift[2]}"/></radialGradient>
<radialGradient id="aura" cx="${CX}" cy="${CY}" r="236" gradientUnits="userSpaceOnUse"><stop offset="0.6" stop-color="${rift[1]}" stop-opacity="0.9"/><stop offset="1" stop-color="${rift[1]}" stop-opacity="0"/></radialGradient>
<linearGradient id="bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
<clipPath id="outer"><path d="${d}"/></clipPath>
<clipPath id="inner"><path d="${d}" ${innerT}/></clipPath>
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
${realmStars}
${tierSvg(tier, r)}
<ellipse cx="${CX}" cy="478" rx="150" ry="16" fill="#000" opacity="0.3"/>
<path d="${d}" fill="${bandFill}"/>
<g clip-path="url(#outer)">${noFrame ? "" : patternSvg(pattern, r, mat[1], mat[2])}<rect width="512" height="512" fill="url(#bevel)"/>${frameExtras(frame, d, r)}</g>
<path d="${d}" fill="none" stroke="${noFrame ? rift[1] : OUT}" stroke-width="${noFrame ? 4 : 7}" stroke-linejoin="round"/>
<g clip-path="url(#inner)">${riftSvg(r, rift)}${coreSvg(core, r, rift)}</g>
<path d="${d}" ${innerT} fill="none" stroke="${noFrame ? rift[0] : OUT}" stroke-width="${noFrame ? 8 : 9}" stroke-linejoin="round" opacity="${noFrame ? 0.8 : 1}"/>
${sigilSvg(sigil, top)}
</svg>`;
  return { meta: { id, name: `Portal #${id}`, image: `/portals/${id}.webp`, traits }, svg };
}

async function main() {
  const outDir = path.join(process.cwd(), "public", "portals");
  mkdirSync(outDir, { recursive: true });
  if (keepSvg) mkdirSync(path.join(outDir, "svg"), { recursive: true });
  const metas = [];
  for (let id = 1; id <= SUPPLY; id++) {
    const { meta, svg } = makePortal(id);
    metas.push(meta);
    if (keepSvg) writeFileSync(path.join(outDir, "svg", `${id}.svg`), svg);
    await sharp(Buffer.from(svg)).resize(320, 320).webp({ quality: 82 }).toFile(path.join(outDir, `${id}.webp`));
  }
  writeFileSync(path.join(process.cwd(), "data", "portals.json"), JSON.stringify(metas, null, 1) + "\n");
  const count = (type) => metas.reduce((m, p) => {
    const v = p.traits.find((t) => t.trait_type === type).value;
    m[v] = (m[v] ?? 0) + 1;
    return m;
  }, {});
  for (const t of ["Tier", "Gate", "Core", "Frame", "Sigil"]) console.log(t, JSON.stringify(count(t)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
