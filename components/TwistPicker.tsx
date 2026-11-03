"use client";
import { TWISTS, type TwistId, twistById } from "@/lib/twists";

// Pick a harder way to play before the first move. Locked once the board is open so nobody
// switches rules halfway. Display only: it never changes the board or the winner check.
export default function TwistPicker({ value, onChange, locked }: { value: TwistId; onChange: (id: TwistId) => void; locked: boolean }) {
  const t = twistById(value);
  return (
    <div className="mb-2" aria-label="How hard do you want it?">
      <div className="twist-row" role="group">
        {TWISTS.map((x) => (
          <button key={x.id} type="button" className="twist-btn" aria-pressed={value === x.id} disabled={locked && value !== x.id} onClick={() => onChange(x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      {value !== "classic" && <p className="mt-1.5 text-[12px] leading-snug text-text2" role="status">{t.why}{locked ? " (locked for this board)" : ""}</p>}
    </div>
  );
}
