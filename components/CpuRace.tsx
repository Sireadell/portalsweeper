"use client";
import { CPU_LEVELS, cpuPercent, cpuTotalSeconds, cpuVerdict, type CpuLevel } from "@/lib/cpu";

// Pick an opponent before the first move, then watch the two bars. Display only: the board and the
// winner check are untouched, and the result is not ranked.
export function CpuPicker({ value, onChange, locked }: { value: CpuLevel; onChange: (l: CpuLevel) => void; locked: boolean }) {
  return (
    <div className="twist-row mb-2" role="group" aria-label="Race the computer">
      {CPU_LEVELS.map((l) => (
        <button key={l.id} type="button" className="twist-btn" aria-pressed={value === l.id} disabled={locked && value !== l.id} onClick={() => onChange(l.id)}>
          {l.name}
        </button>
      ))}
    </div>
  );
}

export function CpuBars({ level, safeTiles, openedSafe, elapsed, over, won }: {
  level: CpuLevel; safeTiles: number; openedSafe: number; elapsed: number; over: boolean; won: boolean;
}) {
  if (level === "off") return null;
  const you = over && won ? 100 : Math.min(99, Math.floor((100 * openedSafe) / Math.max(1, safeTiles)));
  const cpu = cpuPercent(level, safeTiles, elapsed);
  const verdict = over ? cpuVerdict(level, safeTiles, won, elapsed) : null;
  const total = cpuTotalSeconds(level, safeTiles);
  return (
    <div className="race mb-3" aria-label="Race against the computer">
      {[{ k: "you", label: "You", pct: you, me: true }, { k: "cpu", label: "CPU", pct: cpu, me: false }].map((r) => (
        <div key={r.k} className="race-row">
          <span className="race-name">{r.label}</span>
          <div className="race-track" role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.label} progress`}>
            <i data-me={r.me} style={{ width: `${r.pct}%` }} />
          </div>
          <span className="race-pct">{r.pct}%</span>
        </div>
      ))}
      <p className="text-[12px] leading-snug text-mute">
        {verdict
          ? verdict.youWon ? `You beat the CPU by ${verdict.margin}s.` : won ? `The CPU got there first, by ${verdict.margin}s.` : "A mine ended your run, so the CPU wins this one."
          : `The CPU clears a board this size in about ${total}s at a steady pace. It does not play your board. Practice only, not ranked.`}
      </p>
    </div>
  );
}
