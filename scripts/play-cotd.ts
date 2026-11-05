// Plays today's ranked Challenge of the Day on production with a team test wallet (Player A or Player B).
// This is a team test wallet entry, never an outside player.
// Look first (no move sent): npx tsx scripts/play-cotd.ts --wallet A --dry
// Play for real:             npx tsx scripts/play-cotd.ts --wallet A
// It only opens cells it has proven safe. If it is ever forced to guess it stops and says so, unless --allow-guess is given.
// The try survives a stop: starting again picks the same try back up.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { cotdMessage } from "../lib/cotd-message";
import { neighbors } from "../lib/engine";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const BASE = arg("--base") ?? "https://portalsweeper.vercel.app";
const which = (arg("--wallet") ?? "A").toUpperCase();
const dry = process.argv.includes("--dry");
const allowGuess = process.argv.includes("--allow-guess");
const PACE_MS = 600;

const rawKey = process.env[`PLAYER_${which}_PRIVATE_KEY`];
if (!rawKey) throw new Error(`No key for player ${which}`);
const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex);
const date = new Date().toISOString().slice(0, 10);

type Live = { board: { cols: number; rows: number; mines: number; cells: { mine: boolean; adj: number }[]; freePeek?: number }; revealed: boolean[]; flagged: boolean[]; shielded: number[]; status: string; started: boolean; elapsed: number; hit?: number };

async function post(body: object) {
  const r = await fetch(`${BASE}/api/cotd`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`${r.status}: ${j.error}`);
  return j;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- solver ----
type Plan = { safe: number[]; guess?: { idx: number; risk: number } };
function solve(live: Live, known: Set<number>): Plan {
  const { cols, rows, cells, mines } = live.board;
  const total = cols * rows;
  const isKnownMine = (i: number) => known.has(i) || live.flagged[i] || live.shielded.includes(i);
  const hidden = (i: number) => !live.revealed[i] && !isKnownMine(i);
  const safeSet = new Set<number>();
  // constraints from every opened number
  type C = { cells: number[]; r: number };
  const build = (): C[] => {
    const cs: C[] = [];
    for (let i = 0; i < total; i++) {
      if (!live.revealed[i] || cells[i].adj === 0) continue;
      const nb = neighbors(i, cols, rows);
      const u = nb.filter((n) => hidden(n) && !safeSet.has(n));
      const r = cells[i].adj - nb.filter(isKnownMine).length;
      if (u.length) cs.push({ cells: u, r });
    }
    return cs;
  };
  // simple rules until nothing changes
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of build()) {
      if (c.r === 0) { for (const x of c.cells) if (!safeSet.has(x)) { safeSet.add(x); changed = true; } }
      else if (c.r === c.cells.length) { for (const x of c.cells) if (!known.has(x)) { known.add(x); changed = true; } }
    }
    if (changed) continue;
  }
  const open = [...safeSet].filter((i) => !live.revealed[i]);
  if (open.length) return { safe: open };
  // exact enumeration on each connected group of frontier cells
  const cs = build();
  const frontier = [...new Set(cs.flatMap((c) => c.cells))];
  const pos = new Map(frontier.map((c, k) => [c, k]));
  const parent = frontier.map((_, k) => k);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (const c of cs) for (const x of c.cells.slice(1)) parent[find(pos.get(x)!)] = find(pos.get(c.cells[0])!);
  const groups = new Map<number, number[]>();
  frontier.forEach((c, k) => { const g = find(k); (groups.get(g) ?? groups.set(g, []).get(g)!).push(c); });
  const prob = new Map<number, number>();
  let expectedFrontierMines = 0;
  for (const g of groups.values()) {
    if (g.length > 34) throw new Error("A frontier group is too big to enumerate safely.");
    const gs = new Set(g);
    const gcs = cs.filter((c) => gs.has(c.cells[0]));
    const idxOf = new Map(g.map((c, k) => [c, k]));
    const mineCount = new Array(g.length).fill(0);
    let sols = 0;
    const val: number[] = new Array(g.length).fill(-1);
    const byCell: C[][] = g.map(() => []);
    for (const c of gcs) for (const x of c.cells) byCell[idxOf.get(x)!].push(c);
    const ok = (c: C) => {
      let m = 0, un = 0;
      for (const x of c.cells) { const v = val[idxOf.get(x)!]; if (v === 1) m++; else if (v === -1) un++; }
      return m <= c.r && m + un >= c.r;
    };
    const rec = (k: number) => {
      if (k === g.length) { sols++; for (let j = 0; j < g.length; j++) if (val[j] === 1) mineCount[j]++; return; }
      for (const v of [0, 1]) {
        val[k] = v;
        if (byCell[k].every(ok)) rec(k + 1);
      }
      val[k] = -1;
    };
    rec(0);
    if (sols === 0) throw new Error("Solver found no consistent layout, stopping.");
    g.forEach((c, j) => { const p = mineCount[j] / sols; prob.set(c, p); expectedFrontierMines += p; });
  }
  const sure = frontier.filter((c) => prob.get(c) === 0);
  for (const c of frontier) if (prob.get(c) === 1) known.add(c);
  if (sure.length) return { safe: sure };
  // nothing certain: pick the lowest risk cell
  const minesLeft = mines - [...Array(total).keys()].filter(isKnownMine).length;
  const rest = [...Array(total).keys()].filter((i) => hidden(i) && !pos.has(i));
  if (rest.length === 0 && frontier.length === 0) return { safe: [] };
  const restP = rest.length ? Math.max(0, (minesLeft - expectedFrontierMines) / rest.length) : 1;
  let best = { idx: -1, risk: 2 };
  for (const [c, p] of prob) if (p < best.risk) best = { idx: c, risk: p };
  if (rest.length && restP < best.risk) best = { idx: rest[0], risk: restP };
  return { safe: [], guess: best };
}

async function main() {
  console.log(`Team test wallet Player ${which} (${account.address}), COTD ${date}${dry ? " (dry, nothing sent)" : ""}`);
  const signature = await account.signMessage({ message: cotdMessage(date) });
  const base = { address: account.address, signature };
  if (dry) { console.log("Would start the ranked try now. Stopping."); return; }
  const started = await post({ action: "start", ...base });
  let live: Live = started.live;
  console.log(`Started on Portal #${started.meta?.id}, ${live.board.cols}x${live.board.rows}, ${live.board.mines} mines, status ${live.status}`);
  const known = new Set<number>();
  const move = async (idx: number) => {
    await sleep(PACE_MS);
    const out = await post({ action: "move", ...base, date, move: { action: "reveal", idx } });
    live = out.live;
    if (live.status === "won" || live.status === "lost") { console.log(`Finished: ${live.status.toUpperCase()} in ${live.elapsed}s, rank ${out.rank}`); return true; }
    return false;
  };
  if (!live.started) {
    const mid = Math.floor(live.board.rows / 2) * live.board.cols + Math.floor(live.board.cols / 2);
    console.log(`First click at ${mid}`);
    if (await move(mid)) return;
  }
  for (;;) {
    const plan = solve(live, known);
    if (plan.safe.length) {
      for (const i of plan.safe) { if (live.revealed[i]) continue; if (await move(i)) return; }
      continue;
    }
    if (!plan.guess) throw new Error("No move found.");
    console.log(`Forced guess: cell ${plan.guess.idx}, mine chance ${(plan.guess.risk * 100).toFixed(1)}%`);
    if (!allowGuess) { console.log("Stopping. Run again with --allow-guess to take it."); return; }
    if (await move(plan.guess.idx)) return;
  }
}
main().then(async () => {
  const r = await fetch(`${BASE}/api/cotd?address=${account.address}`);
  const s = (await r.json()) as any;
  console.log("My status:", JSON.stringify(s.mine));
  console.log("Leaderboard:", JSON.stringify(s.leaderboard));
}).catch((e) => { console.error("Error:", e.message); process.exit(1); });
