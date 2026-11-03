"use client";
import type { ChallengeView, ChallengeBoards, SeatBoard } from "@/lib/challenge";

// A small picture of what a player has opened so far. No numbers and no mines, only open, flagged or closed.
export function MiniBoard({ b, size = 220 }: { b: SeatBoard; size?: number }) {
  const cell = Math.max(6, Math.floor(size / Math.max(b.cols, b.rows)));
  return (
    <div
      className="mini-board"
      role="img"
      aria-label={`${b.revealed.filter(Boolean).length} tiles open`}
      style={{ gridTemplateColumns: `repeat(${b.cols}, ${cell}px)`, gridAutoRows: `${cell}px` }}
    >
      {b.revealed.map((r, i) => (
        <i key={i} data-open={r} data-flag={b.flagged[i] && !r} />
      ))}
    </div>
  );
}

const STATE_TEXT = { waiting: "Ready", playing: "Playing", won: "Cleared it", lost: "Hit a mine" } as const;
const short = (w: string | null) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "Waiting");

// Both players' boards side by side. `me` highlights your own side; leave it null on the watch page.
export default function DuelBoards({ view, boards, me, progress }: { view: ChallengeView; boards: ChallengeBoards | null; me: string | null; progress?: { creator?: number; opponent?: number } | null }) {
  if (!boards) return null;
  return (
    <div className="duel-grid" aria-label="Both boards">
      {view.players.map((p) => {
        const b = boards[p.role];
        const mine = !!p.wallet && p.wallet === me;
        const label = mine ? "You" : me === null ? (p.role === "creator" ? "Challenger" : "Friend") : p.role === "creator" ? "Challenger" : "Friend";
        return (
          <div key={p.role} className="duel-side" data-me={mine}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <b className="text-[14px] text-white">{label} <span className="text-[12px] font-normal text-mute">{short(p.wallet)}</span></b>
              <span className="text-[12px] text-mute">{b ? STATE_TEXT[b.state] : "Not here yet"}{progress?.[p.role] != null ? ` · ${progress[p.role]}%` : ""}</span>
            </div>
            {b ? <MiniBoard b={b} /> : <div className="mini-empty">Waiting for this player</div>}
          </div>
        );
      })}
    </div>
  );
}
