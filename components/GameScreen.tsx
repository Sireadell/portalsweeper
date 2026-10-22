"use client";
import { useEffect, useRef, useState } from "react";
import type { Board as BoardT, PotMeta } from "@/lib/types";
import { chord, flag, initGame, minesLeft, reveal, seconds, type GameState } from "./gameLogic";
import Board from "./Board";
import PotArt from "./PotArt";
import CommitChip from "./CommitChip";
import RuleCards from "./RuleCards";
import ShareButton from "./ShareButton";
import ProofBadge from "./ProofBadge";
import SoundToggle from "./SoundToggle";
import { artName, potLabel } from "@/lib/names";
import { play, readMuted, soundForMove, unlockAudio, writeMuted, type MoveSummary } from "@/lib/sound";
import type { Move } from "@/lib/game";

export type Mode = "daily" | "practice" | "cotd" | "cotd-free";
type Saved = { won: boolean; seconds: number; moves: number };

const RULE_ICON: Record<string, string> = { "tier-size": "▦", "glaze-peek": "✨", "charm-flag": "⚑", "lid-shield": "🛡" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function untilTomorrow(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const m = Math.max(0, Math.floor((next - now.getTime()) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function GameScreen({
  meta, board, mode, onAgain, address, onFinish, footer,
}: { meta: PotMeta; board: BoardT; mode: Mode; onAgain?: () => void; address?: string | null; onFinish?: (r: { won: boolean; seconds: number; moves: number; moveList?: Move[] }) => void; footer?: React.ReactNode }) {
  const date = board.date;
  const [state, setState] = useState<GameState>(() => initGame(board));
  const [flagMode, setFlagMode] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [, tick] = useState(0);
  const [muted, setMuted] = useState(false);
  const storeKey = `potsweeper:${meta.id}:${date}`;

  useEffect(() => {
    setState(initGame(board));
    setSaved(null);
    if (mode === "daily") {
      try {
        const raw = localStorage.getItem(storeKey);
        if (raw) setSaved(JSON.parse(raw) as Saved);
      } catch { /* storage may be blocked, play still works */ }
    }
  }, [board, mode, storeKey]);

  // Sound stays off until the first tap or key press (browser rule), then wins and losses can play.
  useEffect(() => {
    setMuted(readMuted());
    const wake = () => unlockAudio();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    if (state.status === "won") play("win", muted);
    else if (state.status === "lost") play("lose", muted);
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Little sounds while playing: a click for an opened square, a rising run when a patch opens,
  // a tick for flags, a ping when the Lid shield takes a hit.
  const lastMove = useRef<MoveSummary | null>(null);
  useEffect(() => {
    const now: MoveSummary = {
      revealed: state.g.revealed.filter(Boolean).length,
      flagged: state.g.flagged.filter(Boolean).length,
      shielded: state.g.shielded.length,
      over: state.status === "won" || state.status === "lost",
    };
    const prev = lastMove.current;
    lastMove.current = now;
    if (!prev || state.g.moves.length === 0) return; // a fresh board makes no sound
    const kind = soundForMove(prev, now);
    if (kind) play(kind, muted);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Personal best per board size, kept in this browser only.
  const [bestNote, setBestNote] = useState<string | null>(null);
  useEffect(() => {
    if (state.status !== "won") { setBestNote(null); return; }
    const secs = seconds(state);
    const key = `potsweeper:best:${board.cols}x${board.rows}`;
    try {
      const prev = Number(localStorage.getItem(key));
      if (!prev || secs < prev) {
        localStorage.setItem(key, String(secs));
        setBestNote(prev ? `New personal best! ${fmt(prev - secs)} faster than before.` : "That is your first time on this board size. Beat it next round.");
      } else {
        setBestNote(`Your best on this board size is ${fmt(prev)}. ${fmt(secs - prev)} to beat.`);
      }
    } catch { /* storage may be blocked */ }
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSound() {
    unlockAudio();
    const next = !muted;
    setMuted(next);
    writeMuted(next);
  }

  useEffect(() => {
    if (state.status !== "playing") return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [state.status]);

  // Save the finished day once.
  useEffect(() => {
    if ((mode === "cotd" || mode === "cotd-free" || mode === "practice") && (state.status === "won" || state.status === "lost")) {
      // moveList is the full move log, kept for callers that want to replay a game.
      onFinish?.({ won: state.status === "won", seconds: seconds(state), moves: state.moves, moveList: state.g.moves.slice() });
      return;
    }
    if (mode !== "daily" || (state.status !== "won" && state.status !== "lost")) return;
    const result: Saved = { won: state.status === "won", seconds: seconds(state), moves: state.moves };
    try { localStorage.setItem(storeKey, JSON.stringify(result)); } catch { /* ignore */ }
    fetch("/api/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenId: meta.id, date, ...result }),
    }).catch(() => { /* route may not exist yet, fail silently */ });
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = state.status === "won" || state.status === "lost";
  const view: GameState | null = saved ? null : state;

  const finished = saved ?? (done ? { won: state.status === "won", seconds: seconds(state), moves: state.moves } : null);
  const sub =
    mode === "daily" ? `Today's board, ${date} (UTC)`
      : mode === "cotd" ? `Pot of the day, ranked, ${date} (UTC)`
        : mode === "cotd-free" ? `Pot of the day, not ranked, ${date} (UTC)`
          : "Practice board, not ranked";

  return (
    <div className="mx-auto w-full max-w-[1060px]">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
        {/* Left: name, live stats and the board */}
        <div className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[26px] font-extrabold leading-tight tracking-tight text-white sm:text-[30px]">{potLabel(meta.id)}</h2>
              <p className="text-[13px] text-mute">
                {sub}{artName(meta) ? ` · Art: ${artName(meta)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-stretch gap-2 text-right">
              <Stat label="Mines left" value={view ? String(minesLeft(board, view)) : String(board.mines)} />
              <Stat label="Time" value={fmt(view ? seconds(view) : saved!.seconds)} />
            </div>
          </div>

          <div className="mb-3 flex items-start justify-between gap-2">
            {!saved && board.rules.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Active rules">
                {board.rules.map((r) => (
                  <li key={r.id} className="chip"><span aria-hidden>{RULE_ICON[r.id] ?? "✦"}</span> {r.trait}: {r.value}</li>
                ))}
              </ul>
            ) : <span />}
            <SoundToggle muted={muted} onToggle={toggleSound} />
          </div>

          {saved ? (
            <SavedDay meta={meta} saved={saved} />
          ) : (
            <>
              <Board
                board={board}
                meta={meta}
                state={state}
                flagMode={flagMode}
                onReveal={(i) => setState((s) => reveal(board, s, i))}
                onFlag={(i) => setState((s) => flag(s, i))}
                onChord={(i) => setState((s) => chord(board, s, i))}
              />
              {!done && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    aria-pressed={flagMode}
                    onClick={() => setFlagMode((f) => !f)}
                    className={`btn-ghost !min-h-[44px] !px-4 !text-[14px] ${flagMode ? "btn-on" : ""}`}
                  >
                    ⚑ Flag mode {flagMode ? "on" : "off"}
                  </button>
                  <p className="text-right text-[12px] leading-snug text-mute">
                    Tap to dig. Hold a tile to flag.<br />Tap a number to clear around it.
                  </p>
                </div>
              )}
              {state.shieldedAt.length > 0 && !done && (
                <p className="toast" role="status">🛡 Your Lid took that hit. It is used up now.</p>
              )}
            </>
          )}
        </div>

        {/* Right on desktop, below the board on phones: result, rules and fingerprint */}
        <aside className="min-w-0 space-y-4" aria-label="Board details">
          {finished && (
            <div>
              <Outcome meta={meta} won={finished.won} secs={finished.seconds} moves={finished.moves} mode={mode} onAgain={onAgain}
                rules={board.rules.map((r) => `${r.trait}: ${r.value}`)} size={`${board.cols} by ${board.rows}`} bestNote={saved ? null : bestNote} />
              {finished.won && mode !== "practice" && mode !== "cotd-free" && <ProofBadge date={date} token={meta.id} commit={board.commit} />}
              {finished.won && (
                <ShareButton name={potLabel(meta.id)} params={{ token: meta.id, date, time: Math.round(finished.seconds) }} cols={board.cols} rows={board.rows} />
              )}
            </div>
          )}

          {footer}

          <div className="space-y-3">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-mute">Rules from this Pot</h3>
            <RuleCards board={board} state={state} />
            <CommitChip commit={board.commit} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile min-w-[78px]">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Outcome({ meta, won, secs, moves, mode, onAgain, rules, size, bestNote }: {
  meta: PotMeta; won: boolean; secs: number; moves: number; mode: Mode; onAgain?: () => void; rules: string[]; size: string; bestNote?: string | null;
}) {
  if (won) {
    return (
      <section className="reveal-card" aria-live="polite">
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-mint/60 shadow-[0_10px_30px_-10px_rgba(139,245,192,0.7)] [container-type:inline-size]">
            <PotArt src={meta.image} tokenId={meta.id} className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Board cleared</p>
            <h3 className="mt-1 truncate text-[30px] font-extrabold leading-none tracking-tight text-white">{potLabel(meta.id)}</h3>
            <p className="mt-1.5 text-[13px] text-text2">Its art is fully revealed.</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="stat-tile"><dt className="stat-label">Time</dt><dd className="stat-value">{fmt(secs)}</dd></div>
          <div className="stat-tile"><dt className="stat-label">Moves</dt><dd className="stat-value">{moves}</dd></div>
          <div className="stat-tile"><dt className="stat-label">Board</dt><dd className="stat-value !text-[16px] !leading-[28px]">{size}</dd></div>
        </dl>
        <p className="mt-3 text-[14px] text-text2">
          Cleared in {fmt(secs)} with {moves} moves.{mode === "practice" ? " Practice runs are not ranked." : mode === "cotd-free" ? " This try is not ranked." : ""}
        </p>
        {bestNote && <p className="mt-2 text-[14px] font-semibold text-mint" data-testid="best-note">{bestNote}</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {rules.map((r) => (<li key={r} className="chip">{r}</li>))}
        </ul>
        {(mode === "practice" || mode === "cotd-free") && onAgain && <button className="btn-main mt-4 w-full sm:w-auto" onClick={onAgain}>{mode === "cotd-free" ? "Play today's Pot again" : "Play another Pot"}</button>}
        {mode !== "practice" && mode !== "cotd-free" && <p className="mt-3 text-[13px] text-mute">Next board in {untilTomorrow()}.</p>}
      </section>
    );
  }
  return (
    <section className="lost-card" aria-live="polite">
      <p className="eyebrow !text-[#ff9aab]">Mine hit</p>
      <h3 className="mt-1 text-[30px] font-extrabold leading-none text-white">Boom.</h3>
      <p className="mt-2 text-[14px] text-[#f0d3da]">
        {mode !== "practice" && mode !== "cotd-free"
          ? `${potLabel(meta.id)} stays hidden today. A fresh board opens in ${untilTomorrow()}. Come back tomorrow.`
          : "That one got you. Practice boards are free, so try again."}
      </p>
      {(mode === "practice" || mode === "cotd-free") && onAgain && <button className="btn-main mt-4 w-full sm:w-auto" onClick={onAgain}>Try again</button>}
    </section>
  );
}

function SavedDay({ meta, saved }: { meta: PotMeta; saved: Saved }) {
  return (
    <div className="board-wrap board-saved" data-status={saved.won ? "won" : "lost"} style={{ aspectRatio: "1 / 1" }}>
      <PotArt src={meta.image} tokenId={meta.id} className="board-art absolute inset-0 h-full w-full" />
      <div className="board-shade" />
      {saved.won && <div className="board-sheen" aria-hidden />}
    </div>
  );
}
