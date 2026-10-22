"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// A looping demo for the home page: a real Portal's art under an 8 by 8 board.
// Tiles open one by one, the mines get flagged, then the board melts away and the art shows.
// The mine layout here is a fixed picture for the demo, not a real daily board.
const N = 8;
const MINES = new Set([0, 1, 8, 7, 15, 56, 57, 63, 62, 29]);
const PORTALS = [7, 9, 1, 209, 69];
const NUM_COLOR = ["", "#7dd3fc", "#86efac", "#fda4af", "#c4b5fd", "#fdba74", "#5eead4", "#f9a8d4", "#f1f5f9"];

function neighbours(i: number): number[] {
  const x = i % N, y = Math.floor(i / N), out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < N && ny < N) out.push(ny * N + nx);
  }
  return out;
}

function plan() {
  const adj = Array.from({ length: N * N }, (_, i) => neighbours(i).filter((j) => MINES.has(j)).length);
  // start on the empty square nearest the middle, open outward like a real flood
  const zeros = adj.map((a, i) => (a === 0 && !MINES.has(i) ? i : -1)).filter((i) => i >= 0);
  const mid = (i: number) => Math.abs((i % N) - 3.5) + Math.abs(Math.floor(i / N) - 3.5);
  const start = zeros.sort((a, b) => mid(a) - mid(b))[0] ?? 0;
  const seen = new Set<number>([start]);
  const order: number[] = [];
  const queue = [start];
  while (queue.length) {
    const i = queue.shift()!;
    order.push(i);
    if (adj[i] === 0) for (const j of neighbours(i)) if (!seen.has(j) && !MINES.has(j)) { seen.add(j); queue.push(j); }
  }
  const dist = (i: number) => Math.hypot((i % N) - (start % N), Math.floor(i / N) - Math.floor(start / N));
  const rest = adj.map((_, i) => i).filter((i) => !seen.has(i) && !MINES.has(i)).sort((a, b) => dist(a) - dist(b));
  return { adj, order: [...order, ...rest], mines: [...MINES] };
}

export default function HeroBoard() {
  const { adj, order, mines } = useMemo(plan, []);
  const total = order.length + mines.length;
  const [step, setStep] = useState(Math.round(order.length * 0.4));
  const [phase, setPhase] = useState<"play" | "won" | "reset">("play");
  const [k, setK] = useState(0);
  const id = PORTALS[k % PORTALS.length];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // stays as a still picture
    let t: ReturnType<typeof setTimeout>;
    if (phase === "play") {
      if (step < total) t = setTimeout(() => setStep((s) => s + (s < 8 ? 2 : 1)), step < order.length ? 210 : 260);
      else t = setTimeout(() => setPhase("won"), 350);
    } else if (phase === "won") {
      t = setTimeout(() => { setPhase("reset"); setStep(0); setK((n) => n + 1); }, 3600);
    } else {
      t = setTimeout(() => setPhase("play"), 120);
    }
    return () => clearTimeout(t);
  }, [phase, step, total, order.length]);

  const open = new Set(order.slice(0, Math.min(step, order.length)));
  const flagged = new Set(mines.slice(0, Math.max(0, step - order.length)));

  return (
    <figure className="mx-auto w-full max-w-[440px]">
      <div className="hero-float">
        <div className="hero-board" data-phase={phase} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/portals/${id}.webp`} alt="" className="board-art" draggable={false} />
          <div className="board-shade" />
          <div className="board-grid" style={{ gridTemplateColumns: `repeat(${N}, 1fr)`, fontSize: `calc(46cqw / ${N})` }}>
            {Array.from({ length: N * N }, (_, i) => {
              const isOpen = open.has(i);
              const isFlag = flagged.has(i);
              return (
                <span key={i} className={`tile ${isOpen ? "tile-open" : ""} ${isFlag ? "tile-flag" : ""}`}
                  style={{ ["--d" as string]: `${((i % N) + Math.floor(i / N)) * 40}ms` }}>
                  {isOpen && adj[i] > 0 && <span className="num" style={{ color: NUM_COLOR[adj[i]] }}>{adj[i]}</span>}
                  {isFlag && <span className="glyph">⚑</span>}
                </span>
              );
            })}
          </div>
          {phase === "won" && <div className="board-sheen" />}
        </div>
      </div>
      <figcaption className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-mute">
        <span>
          <b className="font-display text-[15px] text-white">Portal #{id}</b>{" "}
          {phase === "won" ? "cleared. The art is out." : "Each cleared tile opens a window onto the art."}
        </span>
        <Link href={`/judge?id=${id}`} className="link text-[13px]">Play Portal #{id} →</Link>
      </figcaption>
    </figure>
  );
}
