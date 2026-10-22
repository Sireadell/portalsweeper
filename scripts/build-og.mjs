// Builds app/opengraph-image.png (1200 x 630), the preview picture when the home page is shared.
// Left: the name and one line. Right: a Pot half covered by board tiles.
// Run: node scripts/build-og.mjs
import sharp from "sharp";
import path from "node:path";

const W = 1200, H = 630;
const art = path.join(process.cwd(), "public", "pots", "9.webp");
const BOARD = 470, N = 8, CELL = BOARD / N, BX = 660, BY = 80;
// tiles still covered (1) and opened (0): the art shows through the opened ones
const COVER = [
  "11111111",
  "11110011",
  "11000001",
  "10000001",
  "10000000",
  "11000001",
  "11100011",
  "11111111",
];
const NUMS = { "1,4": 1, "2,2": 2, "3,1": 1, "6,3": 1, "5,1": 2, "2,6": 1, "6,5": 3 };

let tiles = "";
COVER.forEach((row, y) => [...row].forEach((c, x) => {
  const px = BX + x * CELL, py = BY + y * CELL;
  if (c === "1") {
    tiles += `<rect x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="9" fill="url(#tile)"/>`;
    tiles += `<rect x="${px + 2}" y="${py + CELL - 9}" width="${CELL - 4}" height="7" rx="3" fill="#000" opacity="0.25"/>`;
  } else if (NUMS[`${x},${y}`]) {
    const colors = { 1: "#7dd3fc", 2: "#86efac", 3: "#fda4af" };
    const n = NUMS[`${x},${y}`];
    tiles += `<text x="${px + CELL / 2}" y="${py + CELL / 2 + 13}" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="900" font-size="38" fill="${colors[n]}" stroke="#0a0614" stroke-width="7" paint-order="stroke">${n}</text>`;
  }
}));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6452c6"/><stop offset="0.5" stop-color="#4a3a9c"/><stop offset="1" stop-color="#34286f"/></linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9abff"/><stop offset="1" stop-color="#8bf5c0"/></linearGradient>
  </defs>
  ${tiles}
  <rect x="${BX - 1}" y="${BY - 1}" width="${BOARD + 2}" height="${BOARD + 2}" rx="26" fill="none" stroke="#3d3170" stroke-width="2"/>
  <text x="70" y="120" font-family="Segoe UI, Arial" font-weight="800" font-size="22" letter-spacing="4" fill="#8bf5c0">A DAILY PUZZLE ON PORTALDOT</text>
  <text x="68" y="230" font-family="Segoe UI, Arial" font-weight="900" font-size="84" fill="#ffffff" letter-spacing="-2">Your Pot is</text>
  <text x="68" y="325" font-family="Segoe UI, Arial" font-weight="900" font-size="84" fill="url(#hl)" letter-spacing="-2">the board.</text>
  <text x="70" y="400" font-family="Segoe UI, Arial" font-size="27" fill="#cfc9ea">Each of the 500 Pots is its own daily</text>
  <text x="70" y="438" font-family="Segoe UI, Arial" font-size="27" fill="#cfc9ea">minesweeper board. Clear it to reveal the art.</text>
  <rect x="70" y="482" width="300" height="58" rx="29" fill="#836ef9"/>
  <text x="220" y="520" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="800" font-size="25" fill="#fff">Try it, no wallet</text>
  <text x="390" y="519" font-family="Segoe UI, Arial" font-weight="700" font-size="20" fill="#a69fc6">potsweeper.vercel.app</text>
</svg>`;

const artBuf = await sharp(art).resize(BOARD, BOARD).toBuffer();
const mask = Buffer.from(`<svg width="${BOARD}" height="${BOARD}"><rect width="${BOARD}" height="${BOARD}" rx="26" fill="#fff"/></svg>`);
const rounded = await sharp(artBuf).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g1" cx="0.1" cy="0" r="0.9"><stop offset="0" stop-color="#836ef9" stop-opacity="0.45"/><stop offset="1" stop-color="#836ef9" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.8" cy="0.5" r="0.5"><stop offset="0" stop-color="#836ef9" stop-opacity="0.5"/><stop offset="1" stop-color="#836ef9" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#0b0814"/>
  <rect width="${W}" height="${H}" fill="url(#g1)"/>
  <rect width="${W}" height="${H}" fill="url(#g2)"/>
</svg>`);

await sharp(bg)
  .composite([{ input: rounded, left: BX, top: BY }, { input: Buffer.from(svg), left: 0, top: 0 }])
  .png()
  .toFile(path.join(process.cwd(), "app", "opengraph-image.png"));
console.log("app/opengraph-image.png written");
