// Builds public/wall-mosaic.webp: all 500 Pots in one small picture, 25 per row.
// The reveal wall uses it to show every Pot faintly in one download, instead of 500 requests.
// Run: node scripts/build-wall-mosaic.mjs
import sharp from "sharp";
import path from "node:path";

const TOTAL = 500;
const COLS = 25;
const ROWS = Math.ceil(TOTAL / COLS);
const SIZE = 32;
const dir = path.join(process.cwd(), "public", "pots");

const tiles = [];
for (let id = 1; id <= TOTAL; id++) {
  const i = id - 1;
  try {
    const input = await sharp(path.join(dir, `${id}.webp`)).resize(SIZE, SIZE, { fit: "cover" }).toBuffer();
    tiles.push({ input, left: (i % COLS) * SIZE, top: Math.floor(i / COLS) * SIZE });
  } catch {
    // A missing picture just leaves its square dark.
  }
}

await sharp({ create: { width: COLS * SIZE, height: ROWS * SIZE, channels: 3, background: "#1a1430" } })
  .composite(tiles)
  .webp({ quality: 45 })
  .toFile(path.join(process.cwd(), "public", "wall-mosaic.webp"));

console.log(`wall-mosaic.webp: ${tiles.length} Pots, ${COLS} x ${ROWS}, ${SIZE}px each`);
