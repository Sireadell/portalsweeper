"use client";
import { useEffect, useRef, useState } from "react";
import type { Board as BoardT, PortalMeta } from "@/lib/types";
import { chord, flag, fromLive, initGame, minesLeft, reveal, seconds, type GameState } from "./gameLogic";
import Board from "./Board";
import PortalArt from "./PortalArt";
import CommitChip from "./CommitChip";
import RuleCards from "./RuleCards";
import RuleBanner from "./RuleBanner";
import TwistPicker from "./TwistPicker";
import { CpuBars, CpuPicker } from "./CpuRace";
import type { CpuLevel } from "@/lib/cpu";
import ShardBar from "./ShardBar";
import { twistById, isHardcore, type TwistId } from "@/lib/twists";
import { emptyShards, loadShards, recordClear, saveShards, WEEKDAYS, type ShardState ,shardCount, SET_SIZE} from "@/lib/shards";
import ShareButton from "./ShareButton";
import ProofBadge from "./ProofBadge";
import SoundToggle from "./SoundToggle";
import { artName, portalLabel } from "@/lib/names";
import { play, readMuted, soundForMove, unlockAudio, writeMuted, type MoveSummary } from "@/lib/sound";
import type { Move } from "@/lib/game";
import type { LiveState } from "@/lib/live";

export type Mode = "daily" | "practice" | "cotd" | "cotd-free" | "challenge";
type Saved = { won: boolean; seconds: number; moves: number };

const RULE_ICON: Record<string, string> = { "tier-size": "▦", "core-peek": "✨", "sigil-flag": "⚑", "frame-shield": "🛡" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function untilTomorrow(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const m = Math.max(0, Math.floor((next - now.getTime()) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function GameScreen({
  meta, board, mode, onAgain, address, onFinish, footer, live, remote, preset,
}: {
  meta: PortalMeta; board: BoardT; mode: Mode; onAgain?: () => void; address?: string | null;
  onFinish?: (r: { won: boolean; seconds: number; moves: number; moveList?: Move[] }) => void; footer?: React.ReactNode;
  // Server-checked play: the board has its mines hidden and every move goes to `remote`.
  live?: LiveState | null; remote?: (m: Move) => Promise<LiveState>;
  // Chosen on the setup screen before the game: when given, the pickers stay off the game page.
  preset?: { twist: TwistId; cpu: CpuLevel };
}) {
  const date = board.date;
  const fresh = () => (live ? fromLive(null, live) : initGame(board));
  const [state, setState] = useState<GameState>(fresh);
  const [netErr, setNetErr] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const [flagMode, setFlagMode] = useState(false);
  const [twistId, setTwistId] = useState<TwistId>(preset?.twist ?? "classic");
  const [cpu, setCpu] = useState<CpuLevel>(preset?.cpu ?? "off");
  const [shieldFx, setShieldFx] = useState(0);
  const shieldSeen = useRef(0);
  const twist = twistById(twistId);
  const [shards, setShards] = useState<ShardState>(emptyShards);
  const [shardNote, setShardNote] = useState<string | null>(null);
  useEffect(() => { setShards(loadShards()); }, []);
  useEffect(() => { setTwistId(preset?.twist ?? "classic"); setShardNote(null); }, [board]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saved, setSaved] = useState<Saved | null>(null);
  const [, tick] = useState(0);
  const [muted, setMuted] = useState(false);
  const storeKey = `portalsweeper:${meta.id}:${date}`;

  useEffect(() => {
    setState(fresh());
    setSaved(null);
    if (mode === "daily" && !remote) {
      try {
        const raw = localStorage.getItem(storeKey);
        if (raw) setSaved(JSON.parse(raw) as Saved);
      } catch { /* storage may be blocked, play still works */ }
    }
  }, [board, mode, storeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moves go to the server one at a time, in order. Flags show at once; the screen takes the
  // server's answer once nothing else is waiting.
  function send(m: Move) {
    if (!remote) return;
    if (m.action === "flag") setState((s) => flag(s, m.idx));
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const next = await remote(m);
        setNetErr(false);
        if (--pending.current === 0) setState((s) => fromLive(s, next));
      } catch {
        pending.current--;
        setNetErr(true);
      }
    });
  }

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
  // a tick for flags, a ping when the Frame shield takes a hit.
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

  // When the Frame shield takes a mine, make it unmistakable: a badge, a ring across the board and a buzz.
  useEffect(() => {
    const n = state.g.shielded.length;
    if (n > shieldSeen.current && state.g.moves.length > 0) {
      setShieldFx((k) => k + 1);
      try { navigator.vibrate?.([60, 40, 90]); } catch { /* not supported */ }
    }
    shieldSeen.current = n;
  }, [state.g.shielded.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A ranked clear earns that weekday's Shard. Practice boards never do.
  useEffect(() => {
    if (state.status !== "won" || (mode !== "daily" && mode !== "cotd")) return;
    const tier = board.rules.find((r) => r.id === "tier-size")?.value;
    const r = recordClear(loadShards(), { date, tokenId: meta.id, won: true, ranked: true, tier, twist: twistId });
    if (r.earned !== null) {
      saveShards(r.state);
      setShards(r.state);
      setShardNote(`Shard earned: ${WEEKDAYS[r.earned]}.`);
    } else if (r.blockedHard) {
      setShardNote("No Shard for this weekend clear. Weekend Shards need a hard clear: a Rare or bigger Portal, a twist, or a friend win.");
    }
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Personal best per board size, kept in this browser only.
  const [bestNote, setBestNote] = useState<string | null>(null);
  useEffect(() => {
    if (state.status !== "won") { setBestNote(null); return; }
    const secs = seconds(state);
    const key = `portalsweeper:best:${board.cols}x${board.rows}`;
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
    if (remote) {
      if (state.status === "won" || state.status === "lost")
        onFinish?.({ won: state.status === "won", seconds: seconds(state), moves: state.moves, moveList: state.g.moves.slice() });
      return; // the server already recorded it
    }
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
      : mode === "cotd" ? `Portal of the day, ranked, ${date} (UTC)`
        : mode === "cotd-free" ? `Portal of the day, not ranked, ${date} (UTC)`
          : mode === "challenge" ? "Friend challenge, same board for both of you"
            : "Practice board, not ranked";

  return (
    <div className="mx-auto w-full max-w-[1360px]">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
        {/* Left: name, live stats and the board */}
        <div className="min-w-0">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[26px] font-extrabold leading-tight tracking-tight text-white sm:text-[30px]">{portalLabel(meta.id)}</h2>
              {mode !== "practice" && (
                <p className="hidden text-[13px] text-mute sm:block">
                  {sub}{artName(meta) ? ` · Art: ${artName(meta)}` : ""}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-stretch gap-2 text-right">
              <div className="self-center"><SoundToggle muted={muted} onToggle={toggleSound} /></div>
              <Stat label="Mines left" value={view ? String(minesLeft(board, view)) : String(board.mines)} />
              <Stat label="Time" value={fmt(view ? seconds(view) : saved!.seconds)} />
            </div>
          </div>

          {saved ? (
            <SavedDay meta={meta} saved={saved} />
          ) : (
            <>
              {!preset && <TwistPicker value={twistId} onChange={setTwistId} locked={state.startedAt !== null} />}
              <div className="relative">
              {!preset && <RuleBanner board={board} />}
              {shieldFx > 0 && (
                <div key={shieldFx} className="shield-fx" role="status" aria-live="assertive">
                  <div className="shield-ring" aria-hidden />
                  <div className="shield-badge"><span aria-hidden>🛡</span><b>Shield saved you!</b><i>That was a mine. Your Frame took the hit and is used up now.</i></div>
                </div>
              )}
              <Board
                board={board}
                meta={meta}
                state={state}
                twist={twist}
                flagMode={flagMode}
                onReveal={(i) => (remote ? send({ action: "reveal", idx: i }) : setState((s) => reveal(board, s, i)))}
                onFlag={(i) => (remote ? send({ action: "flag", idx: i }) : setState((s) => flag(s, i)))}
                onChord={(i) => (remote ? send({ action: "chord", idx: i }) : setState((s) => chord(board, s, i)))}
              />
              </div>
              {!done && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  {twist.noFlags ? <span className="text-[13px] font-semibold text-mute">No flags in {twist.name}</span> : (
                    <button
                      type="button"
                      aria-pressed={flagMode}
                      onClick={() => setFlagMode((f) => !f)}
                      className={`btn-ghost !min-h-[44px] !px-4 !text-[14px] ${flagMode ? "btn-on" : ""}`}
                    >
                      ⚑ Flag mode {flagMode ? "on" : "off"}
                    </button>
                  )}
                  <p className="text-right text-[12px] leading-snug text-mute">
                    {state.startedAt !== null ? "" : twist.noFlags ? "Tap to dig." : "Tap to dig. Hold a tile to flag."}<br />{state.startedAt !== null ? "" : twist.noChord ? "No number tapping in Street Rules." : "Tap a number to clear around it."}
                  </p>
                </div>
              )}
              {netErr && (
                <p className="toast" role="alert">Lost touch with the server, so that move may not have counted. Refresh to pick the game back up.</p>
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
              {finished.won && !saved && isHardcore(twistId) && <p className="mt-3"><span className="hardcore-badge">Hardcore</span> <span className="text-[13px] text-text2">Cleared with no help.</span></p>}
              {finished.won && mode !== "practice" && mode !== "cotd-free" && mode !== "challenge" && <ProofBadge date={date} token={meta.id} commit={board.commit} />}
              {finished.won && mode !== "challenge" && (
                <ShareButton name={portalLabel(meta.id)} params={{ token: meta.id, date, time: Math.round(finished.seconds) }} cols={board.cols} rows={board.rows} />
              )}
            </div>
          )}

          {footer}

          {mode === "practice" && (
            <>
              {!preset && <CpuPicker value={cpu} onChange={setCpu} locked={state.startedAt !== null} />}
              <CpuBars
                level={cpu}
                safeTiles={board.cells.filter((c) => !c.mine).length}
                openedSafe={state.g.revealed.reduce((n, r, i) => n + (r && !board.cells[i].mine ? 1 : 0), 0)}
                elapsed={seconds(state)}
                over={done}
                won={state.status === "won"}
              />
            </>
          )}

          {(mode === "daily" || mode === "cotd") && <details className="group rounded-xl border border-edge bg-panel/60 px-3 py-2" open={!!shardNote}><summary className="cursor-pointer select-none text-[13px] font-semibold text-text2">Daily shards {shardCount(shards)}/{SET_SIZE}</summary><div className="mt-2"><ShardBar shards={shards} note={shardNote} /></div></details>}

          <div className="space-y-3">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-mute">Rules from this Portal</h3>
            <RuleCards board={board} state={state} />
            {mode !== "practice" && <CommitChip commit={board.commit} />}
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
  meta: PortalMeta; won: boolean; secs: number; moves: number; mode: Mode; onAgain?: () => void; rules: string[]; size: string; bestNote?: string | null;
}) {
  if (won) {
    return (
      <section className="reveal-card" aria-live="polite">
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-mint/60 shadow-[0_10px_30px_-10px_rgba(139,245,192,0.7)] [container-type:inline-size]">
            <PortalArt src={meta.image} tokenId={meta.id} className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Board cleared</p>
            <h3 className="mt-1 truncate text-[30px] font-extrabold leading-none tracking-tight text-white">{portalLabel(meta.id)}</h3>
            <p className="mt-1.5 text-[13px] text-text2">Its art is fully revealed.</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="stat-tile"><dt className="stat-label">Time</dt><dd className="stat-value">{fmt(secs)}</dd></div>
          <div className="stat-tile"><dt className="stat-label">Moves</dt><dd className="stat-value">{moves}</dd></div>
          <div className="stat-tile"><dt className="stat-label">Board</dt><dd className="stat-value !text-[16px] !leading-[28px]">{size}</dd></div>
        </dl>
        <p className="mt-3 text-[14px] text-text2">
          Cleared in {fmt(secs)} with {moves} moves.{mode === "practice" ? " Practice runs are not ranked." : mode === "cotd-free" ? " This try is not ranked." : mode === "challenge" ? " The faster clear wins the challenge." : ""}
        </p>
        {bestNote && <p className="mt-2 text-[14px] font-semibold text-mint" data-testid="best-note">{bestNote}</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {rules.map((r) => (<li key={r} className="chip">{r}</li>))}
        </ul>
        {(mode === "practice" || mode === "cotd-free") && onAgain && <button className="btn-main mt-4 w-full sm:w-auto" onClick={onAgain}>{mode === "cotd-free" ? "Play today's Portal again" : "Play another Portal"}</button>}
        {mode !== "practice" && mode !== "cotd-free" && mode !== "challenge" && <p className="mt-3 text-[13px] text-mute">Next board in {untilTomorrow()}.</p>}
      </section>
    );
  }
  return (
    <section className="lost-card" aria-live="polite">
      <p className="eyebrow !text-[#F6A3AA]">Mine hit</p>
      <h3 className="mt-1 text-[30px] font-extrabold leading-none text-white">Boom.</h3>
      <p className="mt-2 text-[14px] text-[#EBD6C8]">
        {mode === "challenge"
          ? "That one got you, and your one try is used. If your friend clears it, they win."
          : mode !== "practice" && mode !== "cotd-free"
          ? `${portalLabel(meta.id)} stays hidden today. A fresh board opens in ${untilTomorrow()}. Come back tomorrow.`
          : "That one got you. Practice boards are free, so try again."}
      </p>
      {(mode === "practice" || mode === "cotd-free") && onAgain && <button className="btn-main mt-4 w-full sm:w-auto" onClick={onAgain}>Try again</button>}
    </section>
  );
}

function SavedDay({ meta, saved }: { meta: PortalMeta; saved: Saved }) {
  return (
    <div className="board-wrap board-saved" data-status={saved.won ? "won" : "lost"} style={{ aspectRatio: "1 / 1" }}>
      <PortalArt src={meta.image} tokenId={meta.id} className="board-art absolute inset-0 h-full w-full" />
      <div className="board-shade" />
      {saved.won && <div className="board-sheen" aria-hidden />}
    </div>
  );
}
