"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Row = {
  code: string;
  kind: "ranked" | "race";
  portal: string;
  image: string;
  tags: string[];
  startedAt: number;
  endedAt: number | null;
  players: { name: string | null; wallet: string }[];
};

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Every broadcast running right now. No sign-in to look.
export default function LivePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skew, setSkew] = useState(0);
  const [, tick] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch("/api/live", { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        const j = await r.json();
        if (stop) return;
        setRows(j.broadcasts);
        setSkew(j.serverNow - Date.now());
        setFailed(false);
      } catch {
        if (!stop) setFailed(true);
      }
    }
    void load();
    const poll = setInterval(load, 5000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { stop = true; clearInterval(poll); clearInterval(clock); };
  }, []);

  const now = Date.now() + skew;
  return (
    <main className="page-narrow">
      <p className="eyebrow">Live now</p>
      <h1 className="mb-2 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Games you can watch</h1>
      <p className="mb-5 text-[14px] text-text2">Players choose to broadcast. You see their board 15 seconds late and never a mine. No sign-in needed.</p>
      {rows === null && !failed && <p className="text-[14px] text-mute" role="status" aria-busy>Loading…</p>}
      {failed && rows === null && <p className="text-[14px] text-boom" role="alert">Could not load the list. Try again in a moment.</p>}
      {rows && rows.length === 0 && (
        <div className="card p-5 text-[15px] text-text2">
          Nobody is broadcasting right now. Take <Link href="/cotd" className="text-mint underline-offset-2 hover:underline">today's ranked try</Link> and tick "Broadcast my game" to be the first.
        </div>
      )}
      <ul className="grid gap-3">
        {rows?.map((b) => (
          <li key={b.code}>
            <Link href={`/watch/${b.code}`} className="card flex items-center gap-3 p-3 hover:border-portal">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.image} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[15px] text-white">{b.players.length ? b.players.map((p) => p.name ?? p.wallet).join(" vs ") : "Waiting for players"}</b>
                <span className="block truncate text-[13px] text-mute">{b.portal} · {b.endedAt ? "Finished" : `Running ${fmt(now - b.startedAt)}`}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {b.tags.map((t) => (<span key={t} className="rounded border border-edge px-1.5 text-[12px] text-text2">{t}</span>))}
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-mint">Watch</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
