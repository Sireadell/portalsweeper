// Generates the Pot collection: data/pots.json (traits) and public/pots/<id>.webp (art, 320px).
// Fully deterministic: the same script always draws the same 500 Pots.
// Run: node scripts/gen-pots.mjs [--svg] (--svg also keeps the source SVGs in public/pots/svg for checking)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const SUPPLY = 500;
const keepSvg = process.argv.includes("--svg");

// Small seeded random generator (mulberry32). Seeded per Pot, so changing one Pot never shifts another.
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
// Trait tables. Glaze, Lid and Charm change the game rules (see lib/engine.ts).
// ---------------------------------------------------------------------------
const TIERS = [["Common", 65], ["Uncommon", 26], ["Rare", 5], ["Epic", 3], ["Legendary", 1]];
const SHAPES = ["Amphora", "Jar", "Gourd", "Vase", "Urn", "Jug", "Cauldron", "Calabash"];
const CLAYS = {
  Terracotta: ["#c8643b", "#9c4527"], Sand: ["#e2c08d", "#b8935c"], Charcoal: ["#4a4a52", "#2c2c33"],
  Rose: ["#e08e9b", "#b4606f"], Sage: ["#9db58c", "#6f8a5f"], Cobalt: ["#3f63c9", "#28418f"],
  Ochre: ["#d9a23a", "#a87720"], Bone: ["#efe6d2", "#c9bda2"], Plum: ["#8a4f8f", "#5f3263"],
};
const GLAZES = [["Mirror", 9], ["Crystal", 9], ["Gold Leaf", 7], ["Gloss", 11], ["Pearl", 10], ["Satin", 7], ["Matte", 18], ["Raw", 13], ["Crackle", 11], ["Ash", 5]];
const LIDS = [["Clay Lid", 18], ["Iron Lid", 14], ["Brass Lid", 12], ["Stone Lid", 12], ["Cork", 14], ["Cloth Wrap", 12], ["None", 18]];
const CHARMS = [["None", 88], ["Beads", 3], ["Bell", 2.5], ["Feather", 2], ["Cowrie", 2.5], ["Ribbon", 2]];
const PATTERNS = ["Plain", "Stripes", "Zigzag", "Dots", "Waves", "Adire", "Kente", "Rings"];
const BACKGROUNDS = {
  Dawn: ["#ffd9a8", "#ff9e7a"], Lagoon: ["#9fe3d8", "#4fa8b8"], Dusk: ["#b9a6ff", "#6f5bd6"],
  Savanna: ["#f4e3a1", "#d6b456"], Mint: ["#d5f5dc", "#8fd3a5"], Night: ["#3b3f6b", "#1c1f3d"],
  Coral: ["#ffc4c4", "#f07a7a"], Sky: ["#cfe8ff", "#79aef0"], Clay: ["#f1d3bf", "#cf9a78"],
};

// Body profiles: [y, half width] from the rim (top) down to the foot, in a 512 box.
const PROFILES = {
  Amphora: [[150, 34], [175, 30], [215, 70], [285, 100], [350, 88], [400, 52], [420, 40]],
  Jar: [[165, 62], [185, 78], [250, 108], [330, 106], [395, 82], [420, 70]],
  Gourd: [[150, 26], [180, 30], [215, 58], [250, 50], [300, 96], [370, 102], [415, 64]],
  Vase: [[140, 52], [165, 40], [220, 44], [300, 90], [370, 92], [410, 60], [420, 54]],
  Urn: [[160, 70], [180, 60], [220, 100], [300, 112], [365, 92], [395, 50], [420, 66]],
  Jug: [[150, 40], [180, 44], [230, 90], [310, 110], [380, 96], [420, 72]],
  Cauldron: [[195, 98], [215, 112], [280, 124], [350, 118], [395, 88], [415, 60]],
  Calabash: [[175, 20], [190, 26], [220, 70], [290, 116], [360, 112], [405, 70], [418, 40]],
};
const HANDLED = new Set(["Amphora", "Urn", "Jug"]);

// Catmull-Rom through the points, drawn as cubic Beziers.
function smooth(points) {
  let d = "";
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function bodyPath(profile) {
  const left = profile.map(([y, w]) => [256 - w, y]);
  const right = profile.map(([y, w]) => [256 + w, y]).reverse();
  return `M ${left[0][0]} ${left[0][1]}` + smooth(left) + ` L ${right[0][0]} ${right[0][1]}` + smooth(right) + " Z";
}

const OUT = "#2a1a14";

function patternSvg(kind, r, profile, dark, light) {
  const top = profile[0][0] + 30;
  const bottom = profile[profile.length - 1][0] - 20;
  const mid = (top + bottom) / 2;
  const band = (y, h, fill) => `<rect x="100" y="${y}" width="312" height="${h}" fill="${fill}"/>`;
  switch (kind) {
    case "Stripes":
      return [0, 1, 2].map((i) => band(top + 30 + i * 60, 14, i % 2 ? light : dark)).join("");
    case "Rings":
      return band(mid - 40, 8, dark) + band(mid - 20, 22, light) + band(mid + 12, 8, dark);
    case "Zigzag": {
      let d = `M 100 ${mid}`;
      for (let x = 100; x <= 412; x += 24) d += ` L ${x + 12} ${mid - 16} L ${x + 24} ${mid}`;
      return `<path d="${d}" fill="none" stroke="${light}" stroke-width="9" stroke-linejoin="round"/>` +
        band(mid + 24, 6, dark) + band(mid - 40, 6, dark);
    }
    case "Dots": {
      let s = "";
      for (let y = top + 20; y < bottom; y += 34)
        for (let x = 110 + ((y / 34) % 2) * 17; x < 410; x += 34) s += `<circle cx="${x}" cy="${y}" r="6" fill="${light}"/>`;
      return s;
    }
    case "Waves": {
      let s = "";
      for (const y of [mid - 34, mid, mid + 34]) {
        let d = `M 100 ${y}`;
        for (let x = 100; x <= 412; x += 40) d += ` q 10 -14 20 0 q 10 14 20 0`;
        s += `<path d="${d}" fill="none" stroke="${light}" stroke-width="6"/>`;
      }
      return s;
    }
    case "Adire": {
      // Indigo resist-dye style: a grid of circles and crosses.
      let s = band(top, bottom - top, "#2b3a78") ;
      for (let y = top + 22; y < bottom; y += 44)
        for (let x = 122; x < 400; x += 44)
          s += (Math.floor(x / 44) + Math.floor(y / 44)) % 2
            ? `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#c9d4ff" stroke-width="4"/>`
            : `<path d="M ${x - 10} ${y} h 20 M ${x} ${y - 10} v 20" stroke="#c9d4ff" stroke-width="4"/>`;
      return s;
    }
    case "Kente": {
      const cols = ["#f2c230", "#1f8a4c", "#d0352b", "#111111"];
      let s = "";
      for (let y = mid - 50, i = 0; y < mid + 50; y += 20, i++)
        for (let x = 100, j = 0; x < 412; x += 26, j++) s += `<rect x="${x}" y="${y}" width="26" height="20" fill="${cols[(i + j + Math.floor(r() * 2)) % 4]}"/>`;
      return s;
    }
    default:
      return "";
  }
}

function glazeSvg(kind, r, profile) {
  const top = profile[0][0];
  const maxW = Math.max(...profile.map(([, w]) => w));
  const hx = 256 - maxW * 0.45;
  switch (kind) {
    case "Mirror":
      return `<ellipse cx="${hx}" cy="${top + 120}" rx="16" ry="60" fill="#fff" opacity="0.75"/><ellipse cx="${hx + 14}" cy="${top + 205}" rx="6" ry="14" fill="#fff" opacity="0.7"/>`;
    case "Gloss":
    case "Pearl":
      return `<ellipse cx="${hx}" cy="${top + 125}" rx="13" ry="45" fill="#fff" opacity="${kind === "Pearl" ? 0.5 : 0.4}"/>`;
    case "Satin":
      return `<ellipse cx="${hx}" cy="${top + 130}" rx="20" ry="55" fill="#fff" opacity="0.18"/>`;
    case "Crystal": {
      let s = "";
      for (let i = 0; i < 7; i++) {
        const x = 170 + r() * 170, y = top + 70 + r() * 180, k = 6 + r() * 6;
        s += `<path d="M ${x} ${y - k} L ${x + k * 0.6} ${y} L ${x} ${y + k} L ${x - k * 0.6} ${y} Z" fill="#e8fbff" opacity="0.85"/>`;
      }
      return s + `<ellipse cx="${hx}" cy="${top + 120}" rx="12" ry="40" fill="#fff" opacity="0.5"/>`;
    }
    case "Gold Leaf": {
      let s = "";
      for (let i = 0; i < 14; i++) {
        const x = 165 + r() * 180, y = top + 60 + r() * 200;
        s += `<rect x="${x}" y="${y}" width="${5 + r() * 9}" height="${4 + r() * 7}" transform="rotate(${r() * 90} ${x} ${y})" fill="#ffd34d" stroke="#b8860b" stroke-width="1"/>`;
      }
      return s;
    }
    case "Crackle": {
      let s = "";
      for (let i = 0; i < 9; i++) {
        let x = 170 + r() * 170, y = top + 60 + r() * 200, d = `M ${x} ${y}`;
        for (let k = 0; k < 3; k++) d += ` l ${(r() - 0.5) * 30} ${8 + r() * 14}`;
        s += `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="1.6" opacity="0.5"/>`;
      }
      return s;
    }
    case "Ash":
      return `<rect x="100" y="${top}" width="312" height="300" fill="#555" opacity="0.18"/>`;
    default:
      return "";
  }
}

function lidSvg(kind, rimY, rimW, clay) {
  const w = rimW + 10;
  const metal = { "Iron Lid": ["#6b6f76", "#3d4046"], "Brass Lid": ["#e3b341", "#a57a12"], "Stone Lid": ["#a9a49a", "#77736b"], "Clay Lid": clay };
  if (metal[kind]) {
    const [f, d] = metal[kind];
    return `<path d="M ${256 - w} ${rimY} Q 256 ${rimY - 60} ${256 + w} ${rimY} Z" fill="${f}" stroke="${OUT}" stroke-width="5"/>` +
      `<rect x="${256 - w - 4}" y="${rimY - 6}" width="${(w + 4) * 2}" height="12" rx="6" fill="${d}" stroke="${OUT}" stroke-width="5"/>` +
      `<circle cx="256" cy="${rimY - 34}" r="11" fill="${f}" stroke="${OUT}" stroke-width="5"/>`;
  }
  if (kind === "Cork")
    return `<rect x="${256 - rimW + 6}" y="${rimY - 34}" width="${(rimW - 6) * 2}" height="40" rx="6" fill="#c89b62" stroke="${OUT}" stroke-width="5"/>` +
      `<circle cx="${250}" cy="${rimY - 18}" r="3" fill="#8a6235"/><circle cx="${266}" cy="${rimY - 10}" r="2.5" fill="#8a6235"/>`;
  if (kind === "Cloth Wrap")
    return `<path d="M ${256 - w - 6} ${rimY + 4} Q 256 ${rimY - 50} ${256 + w + 6} ${rimY + 4} Q 256 ${rimY + 16} ${256 - w - 6} ${rimY + 4} Z" fill="#e0533d" stroke="${OUT}" stroke-width="5"/>` +
      `<path d="M ${256 - w - 6} ${rimY + 10} L ${256 + w + 6} ${rimY + 10}" stroke="#f6d36a" stroke-width="6"/>`;
  // None: an open dark mouth.
  return `<ellipse cx="256" cy="${rimY}" rx="${rimW}" ry="10" fill="#2a1a14" stroke="${OUT}" stroke-width="5"/>`;
}

function charmSvg(kind, rimY, neckW) {
  const y = rimY + 28;
  switch (kind) {
    case "Beads": {
      let s = `<path d="M ${256 - neckW} ${y} Q 256 ${y + 26} ${256 + neckW} ${y}" fill="none" stroke="${OUT}" stroke-width="2"/>`;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, x = 256 - neckW + t * neckW * 2, yy = y + 26 * 2 * t * (1 - t) * 1;
        s += `<circle cx="${x}" cy="${yy}" r="6" fill="${["#e74c3c", "#f1c40f", "#2ecc71", "#3498db"][i % 4]}" stroke="${OUT}" stroke-width="2"/>`;
      }
      return s;
    }
    case "Bell":
      return `<path d="M ${256 + neckW - 6} ${y} l 0 26" stroke="${OUT}" stroke-width="3"/>` +
        `<path d="M ${256 + neckW - 20} ${y + 52} Q ${256 + neckW - 6} ${y + 12} ${256 + neckW + 8} ${y + 52} Z" fill="#f2c230" stroke="${OUT}" stroke-width="4"/>`;
    case "Feather":
      return `<path d="M ${256 + neckW - 4} ${y} q 40 -60 22 -110 q -36 40 -22 110 Z" fill="#5fb3d9" stroke="${OUT}" stroke-width="4"/>` +
        `<path d="M ${256 + neckW - 4} ${y} q 18 -50 18 -100" fill="none" stroke="${OUT}" stroke-width="2"/>`;
    case "Cowrie":
      return `<path d="M ${256 - neckW} ${y} Q 256 ${y + 20} ${256 + neckW} ${y}" fill="none" stroke="${OUT}" stroke-width="3"/>` +
        `<ellipse cx="256" cy="${y + 20}" rx="13" ry="19" fill="#fbf3e2" stroke="${OUT}" stroke-width="4"/><path d="M 256 ${y + 6} v 28" stroke="${OUT}" stroke-width="2"/>`;
    case "Ribbon":
      return `<path d="M 256 ${y} l -34 -16 l 0 32 Z M 256 ${y} l 34 -16 l 0 32 Z" fill="#e84393" stroke="${OUT}" stroke-width="4" stroke-linejoin="round"/>` +
        `<circle cx="256" cy="${y}" r="8" fill="#e84393" stroke="${OUT}" stroke-width="4"/>`;
    default:
      return "";
  }
}

function handlesSvg(profile, clay) {
  const neck = profile[1];
  const belly = profile[3];
  const one = (sx) => {
    const x0 = 256 + sx * neck[1], x1 = 256 + sx * (belly[1] + 10);
    return `<path d="M ${x0} ${neck[0] + 10} C ${x0 + sx * 70} ${neck[0] - 10}, ${x1 + sx * 40} ${belly[0] - 40}, ${x1 - sx * 6} ${belly[0] - 10}" fill="none" stroke="${OUT}" stroke-width="22" stroke-linecap="round"/>` +
      `<path d="M ${x0} ${neck[0] + 10} C ${x0 + sx * 70} ${neck[0] - 10}, ${x1 + sx * 40} ${belly[0] - 40}, ${x1 - sx * 6} ${belly[0] - 10}" fill="none" stroke="${clay[0]}" stroke-width="12" stroke-linecap="round"/>`;
  };
  return one(-1) + one(1);
}

function tierSvg(tier, r) {
  if (tier === "Legendary" || tier === "Epic") {
    let s = `<circle cx="256" cy="290" r="200" fill="${tier === "Legendary" ? "#fff3b0" : "#ffffff"}" opacity="${tier === "Legendary" ? 0.55 : 0.3}"/>`;
    const n = tier === "Legendary" ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const x = 40 + r() * 432, y = 40 + r() * 200, k = 6 + r() * 8;
      s += `<path d="M ${x} ${y - k} Q ${x} ${y} ${x + k} ${y} Q ${x} ${y} ${x} ${y + k} Q ${x} ${y} ${x - k} ${y} Q ${x} ${y} ${x} ${y - k} Z" fill="#fff"/>`;
    }
    return s;
  }
  if (tier === "Rare") return `<circle cx="256" cy="290" r="190" fill="#fff" opacity="0.18"/>`;
  return "";
}

export function makePot(id) {
  const r = rng(id * 7919 + 20261022);
  const tier = weighted(r, TIERS);
  const shape = pick(r, SHAPES);
  const clayName = pick(r, Object.keys(CLAYS));
  const glaze = weighted(r, GLAZES);
  const lid = weighted(r, LIDS);
  const charm = weighted(r, CHARMS);
  const pattern = pick(r, PATTERNS);
  const bgName = pick(r, Object.keys(BACKGROUNDS));
  const traits = [
    { trait_type: "Tier", value: tier },
    { trait_type: "Shape", value: shape },
    { trait_type: "Clay", value: clayName },
    { trait_type: "Glaze", value: glaze },
    { trait_type: "Lid", value: lid },
    { trait_type: "Charm", value: charm },
    { trait_type: "Pattern", value: pattern },
    { trait_type: "Background", value: bgName },
  ];
  const clay = CLAYS[clayName];
  const bg = BACKGROUNDS[bgName];
  const profile = PROFILES[shape];
  const d = bodyPath(profile);
  const rimY = profile[0][0];
  const rimW = profile[0][1];
  const darkPat = clay[1];
  const lightPat = clayName === "Bone" || clayName === "Sand" ? "#7a4b2a" : "#fbe9d0";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></linearGradient>
<clipPath id="body"><path d="${d}"/></clipPath>
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
${tierSvg(tier, r)}
<ellipse cx="256" cy="440" rx="130" ry="18" fill="#000" opacity="0.18"/>
${HANDLED.has(shape) ? handlesSvg(profile, clay) : ""}
<path d="${d}" fill="${clay[0]}"/>
<g clip-path="url(#body)">${patternSvg(pattern, r, profile, darkPat, lightPat)}${glazeSvg(glaze, r, profile)}<rect x="0" y="0" width="512" height="512" fill="url(#shade)"/></g>
<path d="${d}" fill="none" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
<rect x="${256 - rimW - 8}" y="${rimY - 8}" width="${(rimW + 8) * 2}" height="16" rx="8" fill="${clay[0]}" stroke="${OUT}" stroke-width="5"/>
${lidSvg(lid, rimY, rimW, clay)}
${charmSvg(charm, rimY, profile[1][1])}
</svg>`;
  return { meta: { id, name: `Pot #${id}`, image: `/pots/${id}.webp`, traits }, svg };
}

async function main() {
  const outDir = path.join(process.cwd(), "public", "pots");
  mkdirSync(outDir, { recursive: true });
  if (keepSvg) mkdirSync(path.join(outDir, "svg"), { recursive: true });
  const metas = [];
  for (let id = 1; id <= SUPPLY; id++) {
    const { meta, svg } = makePot(id);
    metas.push(meta);
    if (keepSvg) writeFileSync(path.join(outDir, "svg", `${id}.svg`), svg);
    await sharp(Buffer.from(svg)).resize(320, 320).webp({ quality: 82 }).toFile(path.join(outDir, `${id}.webp`));
  }
  writeFileSync(path.join(process.cwd(), "data", "pots.json"), JSON.stringify(metas, null, 1) + "\n");
  const count = (type) => metas.reduce((m, p) => {
    const v = p.traits.find((t) => t.trait_type === type).value;
    m[v] = (m[v] ?? 0) + 1;
    return m;
  }, {});
  for (const t of ["Tier", "Glaze", "Lid", "Charm"]) console.log(t, JSON.stringify(count(t)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
