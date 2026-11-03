"use client";
import { TWISTS, type TwistId } from "@/lib/twists";
import { CPU_LEVELS, type CpuLevel } from "@/lib/cpu";
import { PORTAL_SUPPLY } from "@/lib/types";
import type { PracticeStats } from "@/lib/practice";

export type Setup = { twist: TwistId; cpu: CpuLevel; pick: "random" | "number"; number: string };
export const DEFAULT_SETUP: Setup = { twist: "classic", cpu: "off", pick: "random", number: "" };

const RIVAL_LINE: Record<CpuLevel, string> = {
  off: "Just you and the board",
  easy: "A slow, steady rival",
  medium: "Keeps you honest",
  hard: "Fast. Do not blink",
};
const TWIST_LINE: Record<TwistId, string> = {
  classic: "Normal rules",
  harmattan: "Numbers fade after 3 seconds",
  conductor: "No flags allowed",
  street: "Fading numbers, no flags, no number taps. Earns the Hardcore badge",
};

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="setup-group">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-extrabold uppercase tracking-[0.12em] text-white">{title}</h2>
        {hint && <p className="hidden text-[13px] text-mute sm:block">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Pick({ on, onClick, name, line }: { on: boolean; onClick: () => void; name: string; line: string }) {
  return (
    <button type="button" className="pick" aria-pressed={on} onClick={onClick}>
      <b>{name}</b>
      <span>{line}</span>
    </button>
  );
}

// Everything you decide before a game starts: who you race, how hard, which Portal. The game page itself stays clean.
export default function PracticeSetup({ value, onChange, onPlay, stats, error }: {
  value: Setup; onChange: (s: Setup) => void; onPlay: () => void; stats: PracticeStats; error: string;
}) {
  const set = (p: Partial<Setup>) => onChange({ ...value, ...p });
  return (
    <div className="mx-auto w-full max-w-[1360px]"><div className="max-w-[880px]">
      <div className="mb-6">
        <p className="eyebrow">Practice · no wallet · not ranked</p>
        <h1 className="mt-2 text-[34px] font-extrabold leading-[1.05] tracking-tight text-white sm:text-[44px]">Set up your game</h1>
        <p className="mt-2 max-w-[560px] text-[15px] text-text2">Pick your rival, your rules and a Portal. Then press Play and the board is all you see.</p>
      </div>

      <div className="space-y-7">
        <Group title="Who do you race?">
          <div className="pick-grid">
            {CPU_LEVELS.map((l) => (
              <Pick key={l.id} on={value.cpu === l.id} onClick={() => set({ cpu: l.id })} name={l.name} line={RIVAL_LINE[l.id]} />
            ))}
          </div>
        </Group>

        <Group title="How hard?" hint="Harder rules never change the board, only how you read it">
          <div className="pick-grid">
            {TWISTS.map((t) => (
              <Pick key={t.id} on={value.twist === t.id} onClick={() => set({ twist: t.id })} name={t.name} line={TWIST_LINE[t.id]} />
            ))}
          </div>
        </Group>

        <Group title="Which Portal?">
          <div className="pick-grid pick-grid-2">
            <Pick on={value.pick === "random"} onClick={() => set({ pick: "random" })} name="Surprise me" line="A random Portal from all 500" />
            <Pick on={value.pick === "number"} onClick={() => set({ pick: "number" })} name="I pick one" line={`Type a number, 1 to ${PORTAL_SUPPLY}`} />
          </div>
          {value.pick === "number" && (
            <label className="mt-3 block max-w-[260px]">
              <span className="sr-only">Portal number, 1 to {PORTAL_SUPPLY}</span>
              <input inputMode="numeric" autoFocus value={value.number} onChange={(e) => set({ number: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                className="field font-display text-[20px] font-bold" placeholder={`Portal 1 to ${PORTAL_SUPPLY}`} />
            </label>
          )}
        </Group>
      </div>

      {error && <p className="mt-4 text-[14px] text-boom" role="alert">{error}</p>}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button type="button" className="btn-main btn-lg w-full sm:w-auto sm:min-w-[220px]" onClick={onPlay}>Play</button>
        {stats.boards > 0 && (
          <p className="text-[13px] text-mute tabular-nums">
            Chain {stats.streak} · best {stats.best} · {stats.tiles.toLocaleString("en-US")} tiles cleared, saved in this browser
          </p>
        )}
      </div>
    </div>
  </div>
  );
}
