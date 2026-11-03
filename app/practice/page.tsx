"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, PortalMeta } from "@/lib/types";
import { PORTAL_SUPPLY } from "@/lib/types";
import { generateBoard, getPortalMeta } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import GameScreen from "@/components/GameScreen";
import PracticeSetup, { DEFAULT_SETUP, type Setup } from "@/components/PracticeSetup";
import BoardSkeleton from "@/components/BoardSkeleton";
import { twistById } from "@/lib/twists";
import { CPU_LEVELS } from "@/lib/cpu";
import {
  applyResult, EMPTY_STATS, newPracticeSalt, nextPortalId, parsePortalId, randomPortalId, readStats, tilesForBoard, writeStats,
  type PracticeStats,
} from "@/lib/practice";

type Round = { meta: PortalMeta; salt: string };

export default function PracticePage() {
  const [round, setRound] = useState<Round | null>(null);
  const [started, setStarted] = useState(false);
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [upNext, setUpNext] = useState(1);
  const [err, setErr] = useState("");
  const won = useRef(false);
  const statsRef = useRef<PracticeStats>(EMPTY_STATS);
  const date = todayUTC();

  const load = useCallback(async (id: number) => {
    setErr("");
    try {
      const meta = await getPortalMeta(id);
      won.current = false;
      setRound({ meta, salt: newPracticeSalt() });
      setUpNext(nextPortalId(id));
      return true;
    } catch {
      setErr("Could not load that Portal. Try another number.");
      return false;
    }
  }, []);

  // A link like /practice?id=420 starts that Portal at once. Otherwise you land on the setup screen.
  useEffect(() => {
    const s = readStats();
    statsRef.current = s;
    setStats(s);
    const id = parsePortalId(new URLSearchParams(window.location.search).get("id") ?? "");
    if (id !== null) { setStarted(true); load(id); }
  }, [load]);

  async function play() {
    let id: number;
    if (setup.pick === "number") {
      const n = parsePortalId(setup.number);
      if (n === null) { setErr(`Type a number from 1 to ${PORTAL_SUPPLY}.`); return; }
      id = n;
    } else id = randomPortalId();
    setStarted(true);
    if (!(await load(id))) setStarted(false);
  }

  function backToSetup() { setStarted(false); setRound(null); setErr(""); }

  function finish(board: Board, r: { won: boolean }) {
    won.current = r.won;
    const next = applyResult(statsRef.current, r.won, r.won ? tilesForBoard(board.cols, board.rows, board.mines) : 0);
    statsRef.current = next;
    setStats(next);
    writeStats(next);
  }

  function again() {
    if (!round) return;
    // Won: chain on to the next Portal. Lost: same Portal, fresh board.
    load(won.current ? upNext : round.meta.id);
  }

  // Memoised: a new board object would reset the game in progress.
  const board = useMemo(() => (round ? generateBoard(round.meta, date, round.salt) : null), [round, date]);

  if (!started)
    return (
      <main className="page">
        <PracticeSetup value={setup} onChange={setSetup} onPlay={play} stats={stats} error={err} />
        <p className="mx-auto mt-10 max-w-[1360px] text-[13px] text-mute">
          Every practice board uses a fresh random seed, so it is never a daily board. <Link href="/play" className="text-mint underline-offset-2 hover:underline">Play your ranked daily board</Link>
        </p>
      </main>
    );

  const rival = CPU_LEVELS.find((l) => l.id === setup.cpu)?.name ?? "Solo";
  return (
    <main className="page">
      <div className="mx-auto mb-3 flex w-full max-w-[1360px] flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost h-10" onClick={backToSetup}>← Setup</button>
        <span className="chip">{twistById(setup.twist).name}</span>
        <span className="chip">{rival}</span>
        <span className="chip !border-portal/50 !text-[#F2C873]">Not ranked</span>
        <button type="button" className="btn-ghost ml-auto h-10" onClick={() => load(upNext)}>Next Portal →</button>
      </div>
      {err && <p className="mx-auto mb-3 max-w-[1360px] text-[14px] text-boom" role="alert">{err}</p>}
      {round && board ? (
        <GameScreen
          key={round.salt}
          meta={round.meta}
          board={board}
          mode="practice"
          preset={{ twist: setup.twist, cpu: setup.cpu }}
          onAgain={again}
          onFinish={(r) => finish(board, r)}
        />
      ) : (
        <BoardSkeleton />
      )}
    </main>
  );
}
