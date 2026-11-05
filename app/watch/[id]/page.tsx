"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ChallengeBoards, ChallengeView } from "@/lib/challenge";
import DuelBoards from "@/components/DuelBoards";
import { ChallengeResult } from "@/components/ChallengeRoom";
import { portalLabel } from "@/lib/names";
import LiveBoard from "@/components/LiveBoard";

type Progress = { creator?: number; opponent?: number };

// A read-only view of a challenge for supporters. No wallet, no signing, never a mine.
function ChallengeWatch({ id }: { id: string }) {
  const [view, setView] = useState<ChallengeView | null>(null);
  const [boards, setBoards] = useState<ChallengeBoards | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/challenge?id=${encodeURIComponent(id)}&boards=1`, { cache: "no-store" });
      if (r.status === 404) return setMissing(true);
      if (!r.ok) return;
      const j = await r.json();
      setView(j.challenge);
      setBoards(j.boards ?? null);
      setProgress(j.progress ?? null);
    } catch { /* the next poll tries again */ }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const settled = view?.settled ?? false;
  useEffect(() => {
    if (settled || missing) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [settled, missing, load]);

  if (missing)
    return (
      <main className="page-narrow">
        <h1 className="text-2xl font-bold text-white">That challenge link does not exist.</h1>
        <Link className="btn-main mt-5" href="/challenge">Challenge a friend</Link>
      </main>
    );
  if (!view) return <main className="page-narrow" aria-busy><p className="text-[14px] text-mute" role="status">Loading the race…</p></main>;

  const headline =
    view.settled ? "Race over"
      : view.status === "playing" ? "Live now"
        : view.status === "open" ? "Waiting for the second player"
          : "Closed";
  return (
    <main className="page">
      <section className="mx-auto max-w-[900px] pt-2">
        <p className="eyebrow">Watching a friend challenge</p>
        <h1 className="mb-1 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">{headline}</h1>
        <p className="mb-4 text-[14px] text-text2">{portalLabel(view.tokenId)}. This page updates by itself and never shows where the mines are.</p>
        {boards ? (
          <DuelBoards view={view} boards={boards} me={null} progress={progress} />
        ) : (
          <div className="card p-5 text-[15px] text-text2">
            {view.settled ? "The boards are not kept after a race that was never played." : view.duel ? "The boards appear here as soon as both players are in." : "This is an any-time challenge, so the boards stay private until the result is in."}
          </div>
        )}
        {view.settled && <ChallengeResult view={view} me={null} />}
        <p className="mt-6 text-center text-[14px]">
          {view.duel && !view.settled && (
            <>
              <Link href={`/event/${id}`} className="text-mint underline-offset-2 hover:underline">Back a player</Link>
              {" · "}
            </>
          )}
          <Link href="/challenge" className="text-mint underline-offset-2 hover:underline">Make your own challenge</Link>
        </p>
      </section>
    </main>
  );
}

// /watch/CODE: a live broadcast (a ranked try or a race with a backing event) when the code is one,
// else the plain friend-challenge view. Either way: no sign-in, never a mine.
export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const [mode, setMode] = useState<"checking" | "live" | "challenge">("checking");
  useEffect(() => {
    let stop = false;
    fetch(`/api/live?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => { if (!stop) setMode(r.ok ? "live" : "challenge"); })
      .catch(() => { if (!stop) setMode("challenge"); });
    return () => { stop = true; };
  }, [id]);
  if (mode === "checking") return <main className="page-narrow" aria-busy><p className="text-[14px] text-mute" role="status">Loading…</p></main>;
  if (mode === "challenge") return <ChallengeWatch id={id} />;
  return (
    <main className="page">
      <section className="mx-auto max-w-[900px] pt-2">
        <p className="eyebrow">Live now</p>
        <h1 className="mb-4 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Watching a live game</h1>
        <LiveBoard code={id} />
        <p className="mt-6 text-center text-[14px]">
          <Link href="/live" className="text-mint underline-offset-2 hover:underline">All live games</Link>
          {" · "}
          <Link href="/cotd" className="text-mint underline-offset-2 hover:underline">Play today's Portal</Link>
        </p>
      </section>
    </main>
  );
}
