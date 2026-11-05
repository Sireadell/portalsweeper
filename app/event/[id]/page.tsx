"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BackPanel, { type EventData, type NoEvent } from "@/components/BackPanel";
import LiveBoard from "@/components/LiveBoard";

// /event/RACE: the backing event of a head-to-head race. Anyone can watch; backing needs a wallet.
// The race itself is the live board (15 seconds behind, never a mine).
export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventData | null>(null);
  const [race, setRace] = useState<NoEvent | null>(null);
  const [escrow, setEscrow] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "off">("loading");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/predict?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.status === 404) return setState("missing");
      if (r.status === 503) return setState("off");
      if (!r.ok) return;
      const j = await r.json();
      setEvent(j.event ?? null);
      setRace(j.race ?? null);
      setEscrow(j.escrow ?? j.event?.escrow ?? null);
      setState("ready");
    } catch { /* the next poll tries again */ }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const over = event?.status === "settled" || event?.status === "refunded";
  useEffect(() => {
    if (over) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [over, load]);

  if (state === "missing")
    return (
      <main className="page-narrow">
        <h1 className="text-2xl font-bold text-white">That race does not exist.</h1>
        <Link className="btn-main mt-5" href="/challenge">Challenge a friend</Link>
      </main>
    );
  if (state === "off")
    return (
      <main className="page-narrow">
        <h1 className="text-2xl font-bold text-white">Backing is not switched on here.</h1>
        <p className="mt-2 text-[14px] text-text2">You can still <Link className="text-mint underline-offset-2 hover:underline" href={`/watch/${id}`}>watch the race</Link>.</p>
      </main>
    );
  if (state === "loading") return <main className="page-narrow" aria-busy><p className="text-[14px] text-mute" role="status">Loading the event…</p></main>;

  return (
    <main className="page">
      <section className="mx-auto max-w-[900px] pt-2">
        <p className="eyebrow">Back a player</p>
        <h1 className="mb-1 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">
          {over ? "Event over" : event?.status === "locked" ? "Race in progress" : event ? "Backing is open" : "Backing"}
        </h1>
        <p className="mb-4 text-[14px] text-text2">Two players race on the same board. You put testnet tPOT on the one you think wins, and backers of the winner share the pot. Testnet coins with no value.</p>
        <div className="mb-4"><BackPanel id={id} event={event} race={race} escrow={escrow} onChange={load} /></div>
        <h2 className="mb-2 mt-6 text-[19px] font-bold text-white">The race</h2>
        <LiveBoard code={id} />
        <p className="mt-6 text-center text-[14px]">
          <Link href={`/watch/${id}`} className="text-mint underline-offset-2 hover:underline">Watch page</Link>
          {" · "}
          <Link href="/challenge" className="text-mint underline-offset-2 hover:underline">Make your own race</Link>
        </p>
      </section>
    </main>
  );
}
