"use client";
import { useRef, useState } from "react";
import type { Board as BoardT, PortalMeta } from "@/lib/types";
import type { GameState } from "./gameLogic";
import PortalArt from "./PortalArt";

const NUM_COLOR = ["", "#7dd3fc", "#86efac", "#fda4af", "#c4b5fd", "#fdba74", "#5eead4", "#f9a8d4", "#f1f5f9"];

// Win confetti: small tiles in the game's colours, thrown out from the middle of the board.
const CONFETTI = Array.from({ length: 22 }, (_, k) => {
  const a = (k / 22) * Math.PI * 2 + (k % 3) * 0.3;
  const r = 22 + (k % 5) * 6;
  return {
    "--dx": `${Math.round(Math.cos(a) * r)}cqw`,
    "--dy": `${Math.round(Math.sin(a) * r - 12)}cqw`,
    "--r": `${(k % 2 ? 1 : -1) * (180 + k * 23)}deg`,
    "--t": `${0.45 + (k % 4) * 0.06}s`,
    "--c": ["#8bf5c0", "#a493ff", "#ffd166", "#ff8fa3", "#7dd3fc"][k % 5],
  } as React.CSSProperties;
});

type Props = {
  board: BoardT;
  meta: PortalMeta;
  state: GameState;
  flagMode: boolean;
  onReveal: (i: number) => void;
  onFlag: (i: number) => void;
  onChord: (i: number) => void;
  disabled?: boolean;
  hint?: number | null;
};

export default function Board({ board, meta, state, flagMode, onReveal, onFlag, onChord, disabled, hint }: Props) {
  const { cols, rows } = board;
  const [focus, setFocus] = useState(0);
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; long: boolean }>({ t: null, long: false });
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const over = state.status === "won" || state.status === "lost";

  function down(i: number) {
    press.current.long = false;
    if (press.current.t) clearTimeout(press.current.t);
    press.current.t = setTimeout(() => {
      press.current.long = true;
      onFlag(i);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
    }, 380);
  }
  function up() {
    if (press.current.t) clearTimeout(press.current.t);
    press.current.t = null;
  }
  function click(i: number) {
    if (press.current.long) { press.current.long = false; return; }
    if (disabled || over) return;
    if (state.revealed[i]) { onChord(i); return; }
    if (flagMode) onFlag(i); else onReveal(i);
  }
  function key(e: React.KeyboardEvent, i: number) {
    const x = i % cols, y = Math.floor(i / cols);
    let n = i;
    if (e.key === "ArrowRight" && x < cols - 1) n = i + 1;
    else if (e.key === "ArrowLeft" && x > 0) n = i - 1;
    else if (e.key === "ArrowDown" && y < rows - 1) n = i + cols;
    else if (e.key === "ArrowUp" && y > 0) n = i - cols;
    else if (e.key === "f" || e.key === "F") { e.preventDefault(); if (!disabled && !over) onFlag(i); return; }
    else return;
    e.preventDefault();
    setFocus(n);
    refs.current[n]?.focus();
  }

  const lost = state.status === "lost";
  const won = state.status === "won";

  return (
    <div className="board-wrap" data-status={state.status} style={{ aspectRatio: `${cols} / ${rows}` }}>
      <PortalArt src={meta.image} tokenId={meta.id} className="board-art absolute inset-0 h-full w-full" />
      <div className="board-shade" />
      <div role="grid" aria-label={`Portal #${meta.id} board, ${cols} by ${rows}`} className="board-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, fontSize: `calc(46cqw / ${cols})` }}>
        {board.cells.map((_, i) => {
          const c = state.cells[i];
          const rev = state.revealed[i];
          const fl = state.flagged[i];
          const showMine = lost && c.mine && !fl;
          const wrongFlag = lost && fl && !c.mine;
          const cls = ["tile"];
          if (rev) cls.push("tile-open");
          if (fl) cls.push("tile-flag");
          if (showMine) cls.push(state.hit === i ? "tile-hit" : "tile-mine");
          if (i === board.freePeek) cls.push("tile-peek");
          if (i === board.freeFlag) cls.push("tile-gift");
          if (state.shieldedAt.includes(i)) cls.push("tile-shield");
          if (hint === i && !rev && !fl) cls.push("tile-hint");
          const label = rev ? (c.adj ? `${c.adj} nearby` : "clear") : fl ? "flagged" : "hidden";
          return (
            <button
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              role="gridcell"
              type="button"
              tabIndex={i === focus ? 0 : -1}
              aria-label={`row ${Math.floor(i / cols) + 1} column ${(i % cols) + 1}, ${label}`}
              className={cls.join(" ")}
              style={{ ["--d" as string]: `${((i % cols) + Math.floor(i / cols)) * 38}ms` }}
              onFocus={() => setFocus(i)}
              onKeyDown={(e) => key(e, i)}
              onPointerDown={() => !rev && !disabled && !over && down(i)}
              onPointerUp={up}
              onPointerLeave={up}
              onPointerCancel={up}
              onContextMenu={(e) => { e.preventDefault(); if (!disabled && !over) onFlag(i); }}
              onClick={() => click(i)}
            >
              {rev && c.adj > 0 && <span className="num" style={{ color: NUM_COLOR[c.adj] }}>{c.adj}</span>}
              {state.shieldedAt.includes(i) && <span className="glyph">🛡</span>}
              {!rev && fl && !wrongFlag && <span className="glyph">⚑</span>}
              {wrongFlag && <span className="glyph">✕</span>}
              {showMine && (state.hit === i ? <span className="glyph">💥</span> : <span className="mine-dot" aria-hidden />)}
            </button>
          );
        })}
      </div>
      {won && <div className="board-burst" aria-hidden />}
      {won && <div className="board-sheen" aria-hidden />}
      {won && (
        <div className="board-confetti" aria-hidden>
          {CONFETTI.map((st, k) => <i key={k} style={st} />)}
        </div>
      )}
    </div>
  );
}
