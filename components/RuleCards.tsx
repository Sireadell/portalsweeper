"use client";
import type { Board, FiredRule } from "@/lib/types";
import type { GameState } from "./gameLogic";

const ICON: Record<string, string> = { "tier-size": "▦", "core-peek": "✨", "sigil-flag": "⚑", "frame-shield": "🛡" };
const TITLE: Record<string, string> = {
  "tier-size": "Board size",
  "core-peek": "Free peek",
  "sigil-flag": "Free flag",
  "frame-shield": "Shield",
};

function status(r: FiredRule, b: Board, s: GameState): string {
  if (r.id === "core-peek") return "Fired. Look for the ringed tile.";
  if (r.id === "sigil-flag") return "Fired. One mine is already flagged.";
  if (r.id === "tier-size") return `${b.cols} by ${b.rows}, ${b.mines} mines.`;
  if (r.id === "frame-shield") return s.shieldedAt.length ? "Used. It saved you once." : s.shields > 0 ? "Ready. It saves you once." : "Spent.";
  return "";
}

// Each rule that fired for this Portal, with the plain reason it fired.
export default function RuleCards({ board, state }: { board: Board; state: GameState }) {
  if (!board.rules.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Rules from this Portal's traits">
      {board.rules.map((r, k) => {
        const used = r.id === "frame-shield" && state.shieldedAt.length > 0;
        return (
          <li key={r.id} className={`rule-card ${used ? "rule-used" : ""}`} style={{ animationDelay: `${k * 110}ms` }}>
            <span className="rule-ico" aria-hidden>{ICON[r.id] ?? "✦"}</span>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold leading-tight text-white">{TITLE[r.id] ?? r.id}</p>
              <p className="text-[12px] text-mute">from {r.trait}: {r.value}</p>
              <p className="mt-1 text-[13px] leading-snug text-text2">{r.why}</p>
              <p className="rule-state">{status(r, board, state)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
