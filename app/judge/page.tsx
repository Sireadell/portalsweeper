"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PotMeta } from "@/lib/types";
import { POT_SUPPLY } from "@/lib/types";
import { potFromQuery } from "@/lib/names";
import { generateBoard, getPotMeta } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import GameScreen from "@/components/GameScreen";
import BoardSkeleton from "@/components/BoardSkeleton";

const rand = () => 1 + Math.floor(Math.random() * POT_SUPPLY);

export default function JudgePage() {
  const [meta, setMeta] = useState<PotMeta | null>(null);
  const [salt, setSalt] = useState("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const date = todayUTC();

  const load = useCallback(async (id: number, fixedSalt?: string) => {
    setErr("");
    try {
      const m = await getPotMeta(id);
      setMeta(m);
      setSalt(fixedSalt ?? `practice-${Date.now()}-${Math.random()}`);
      setInput(String(id));
    } catch {
      setErr("Could not load that Pot. Try another number.");
    }
  }, []);

  // Judges should be playing within seconds: start a random Pot straight away.
  // A link like /judge?id=420&salt=abc replays the same practice board.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = potFromQuery(q, POT_SUPPLY);
    const fixed = q.get("salt") ?? undefined;
    load(id ?? rand(), fixed);
  }, [load]);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > POT_SUPPLY) {
      setErr(`Type a number from 1 to ${POT_SUPPLY}.`);
      return;
    }
    load(n);
  }

  return (
    <main className="page">
      <header className="mx-auto mb-5 flex w-full max-w-[1060px] flex-col gap-4 rounded-[20px] border border-edge bg-panel/70 p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-extrabold tracking-tight text-white">Judge mode</h1>
            <span className="chip !border-mint/40 !text-mint">No wallet · not ranked</span>
          </div>
          <p className="mt-1 max-w-[52ch] text-[14px] leading-snug text-text2">
            Play any of the 500 Pots. Each one has its own rules from its traits. <Link href="/practice" className="link">Endless practice →</Link>
          </p>
        </div>
        <form onSubmit={go} className="flex w-full flex-wrap items-end gap-2 lg:w-auto">
          <label className="min-w-[140px] flex-1 lg:w-[180px] lg:flex-none">
            <span className="mb-1 block text-[12px] font-semibold text-mute">Pot number, 1 to {POT_SUPPLY}</span>
            <input
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="field font-display font-bold"
              placeholder="e.g. 420"
            />
          </label>
          <button type="submit" className="btn-main h-11 !py-0">Play</button>
          <button type="button" className="btn-ghost h-11" onClick={() => load(rand())} aria-label="Random">🎲<span className="hidden sm:inline">Random</span></button>
        </form>
      </header>
      {err && <p className="mx-auto mb-3 max-w-[1060px] text-[14px] text-boom" role="alert">{err}</p>}

      {meta && salt ? (
        <GameScreen key={salt} meta={meta} board={generateBoard(meta, date, salt)} mode="practice" onAgain={() => load(rand())} />
      ) : (
        <BoardSkeleton />
      )}
    </main>
  );
}
