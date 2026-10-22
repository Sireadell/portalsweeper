"use client";
import type { PracticeStats } from "@/lib/practice";

export default function PracticeBar({ stats, upNext }: { stats: PracticeStats; upNext: number }) {
  return (
    <section aria-label="Practice chain score" className="mx-auto mb-5 flex w-full max-w-[1060px] flex-col gap-3 rounded-[20px] border border-edge bg-panel p-3 sm:flex-row sm:items-center">
      <div className="grid flex-1 grid-cols-3 gap-2 text-center tabular-nums sm:max-w-[420px]">
        <Cell label="Chain" value={String(stats.streak)} hot={stats.streak > 0} />
        <Cell label="Best chain" value={String(stats.best)} />
        <Cell label="Tiles cleared" value={stats.tiles.toLocaleString("en-US")} />
      </div>
      <p className="text-center text-[12px] leading-snug text-mute sm:flex-1 sm:text-left">
        Clear a board and Pot #{upNext} is next. A boom ends the chain. Scores stay in this browser.
      </p>
    </section>
  );
}

function Cell({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${hot ? "!text-mint" : ""}`}>{value}</div>
    </div>
  );
}
