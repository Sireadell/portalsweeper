"use client";
import { useEffect, useState } from "react";
import type { Board, FiredRule } from "@/lib/types";

const ICON: Record<string, string> = { "tier-size": "▦", "core-peek": "✨", "sigil-flag": "⚑", "frame-shield": "🛡" };
const TITLE: Record<string, string> = {
  "tier-size": "Board size",
  "core-peek": "Free peek",
  "sigil-flag": "Free flag",
  "frame-shield": "Shield",
};
// The rule worth announcing first: the ones that help you beat the ones that only set the size.
const ORDER = ["frame-shield", "sigil-flag", "core-peek", "tier-size"];

export function headlineRule(rules: FiredRule[]): FiredRule | null {
  if (!rules.length) return null;
  return [...rules].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))[0];
}

// One short message over the board when it opens, so the twist is clear at a glance. It fades by itself.
// Display only: it reads the rules the engine already fired and never changes the game.
export default function RuleBanner({ board }: { board: Board }) {
  const rule = headlineRule(board.rules);
  const key = `${board.tokenId}:${board.date}`;
  const [shownKey, setShownKey] = useState<string | null>(key);

  useEffect(() => {
    setShownKey(key);
    const t = setTimeout(() => setShownKey(null), 3800);
    return () => clearTimeout(t);
  }, [key]);

  if (!rule || shownKey !== key) return null;
  return (
    <div className="rule-banner" role="status" aria-live="polite">
      <span className="rule-banner-ico" aria-hidden>{ICON[rule.id] ?? "✦"}</span>
      <div className="min-w-0">
        <p className="rule-banner-head">{TITLE[rule.id] ?? rule.id} <span>from {rule.trait}: {rule.value}</span></p>
        <p className="rule-banner-why">{rule.why}</p>
      </div>
    </div>
  );
}
