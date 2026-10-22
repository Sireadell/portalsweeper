"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, PotMeta } from "@/lib/types";
import { POT_SUPPLY } from "@/lib/types";
import { generateBoard, getPotMeta } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import GameScreen from "@/components/GameScreen";
import PracticeBar from "@/components/PracticeBar";
import BoardSkeleton from "@/components/BoardSkeleton";
import {
  applyResult, EMPTY_STATS, newPracticeSalt, nextPotId, parsePotId, randomPotId, readStats, tilesForBoard, writeStats,
  type PracticeStats,
} from "@/lib/practice";

type Round = { meta: PotMeta; salt: string };

export default function PracticePage() {
  const [round, setRound] = useState<Round | null>(null);
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [upNext, setUpNext] = useState(1);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const won = useRef(false);
  const statsRef = useRef<PracticeStats>(EMPTY_STATS);
  const date = todayUTC();

  const load = useCallback(async (id: number) => {
    setErr("");
    try {
      const meta = await getPotMeta(id);
      won.current = false;
      setRound({ meta, salt: newPracticeSalt() });
      setInput(String(id));
      setUpNext(nextPotId(id));
    } catch {
      setErr("Could not load that Pot. Try another number.");
    }
  }, []);

  // Start at once: ?id=420 picks a Pot, otherwise a random one. Saved scores come back from this browser.
  useEffect(() => {
    const s = readStats();
    statsRef.current = s;
    setStats(s);
    const id = parsePotId(new URLSearchParams(window.location.search).get("id") ?? "");
    load(id ?? randomPotId());
  }, [load]);

  function finish(board: Board, r: { won: boolean }) {
    won.current = r.won;
    const next = applyResult(statsRef.current, r.won, r.won ? tilesForBoard(board.cols, board.rows, board.mines) : 0);
    statsRef.current = next;
    setStats(next);
    writeStats(next);
  }

  function again() {
    if (!round) return;
    // Won: chain on to the next Pot. Lost: same Pot, fresh board.
    load(won.current ? upNext : round.meta.id);
  }

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = parsePotId(input);
    if (n === null) { setErr(`Type a number from 1 to ${POT_SUPPLY}.`); return; }
    load(n);
  }

  // Memoised: a new board object would reset the game in progress.
  const board = useMemo(() => (round ? generateBoard(round.meta, date, round.salt) : null), [round, date]);

  return (
    <main className="page">
      <header className="mx-auto mb-4 flex w-full max-w-[1060px] flex-col gap-4 rounded-[20px] border border-edge bg-panel/70 p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-extrabold tracking-tight text-white">Practice</h1>
            <span className="chip !border-pot/50 !text-[#c4b8ff]">No wallet · not ranked</span>
          </div>
          <p className="mt-1 max-w-[52ch] text-[14px] leading-snug text-text2">Endless boards. Clear one and the next Pot is lined up for you.</p>
        </div>
        <form onSubmit={go} className="flex w-full flex-wrap items-end gap-2 lg:w-auto">
          <label className="min-w-[120px] flex-1 lg:w-[160px] lg:flex-none">
            <span className="mb-1 block text-[12px] font-semibold text-mute">Any Pot, 1 to {POT_SUPPLY}</span>
            <input
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="field font-display font-bold"
              placeholder="e.g. 420"
            />
          </label>
          <button type="submit" className="btn-main h-11 !py-0">Play</button>
          <button type="button" className="btn-ghost h-11" onClick={() => load(randomPotId())} aria-label="Random">🎲<span className="hidden sm:inline">Random</span></button>
          <button type="button" className="btn-ghost h-11" onClick={() => load(upNext)}>Next Pot →</button>
        </form>
      </header>
      {err && <p className="mx-auto mb-3 max-w-[1060px] text-[14px] text-boom" role="alert">{err}</p>}

      <PracticeBar stats={stats} upNext={upNext} />

      {round && board ? (
        <GameScreen
          key={round.salt}
          meta={round.meta}
          board={board}
          mode="practice"
          onAgain={again}
          onFinish={(r) => finish(board, r)}
        />
      ) : (
        <BoardSkeleton />
      )}
      <p className="mx-auto mt-8 max-w-[640px] text-center text-[13px] text-mute">
        No wallet needed. Every board uses a fresh random seed, so it is never a daily board. <Link href="/play" className="text-mint underline-offset-2 hover:underline">Play your ranked daily board</Link>
      </p>
    </main>
  );
}
