"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import PortalArt from "./PortalArt";
import { portalLabel } from "@/lib/names";

export type CotdView = {
  date: string;
  tokenId: number;
  nextUtc: number;
  attempts: number;
  cleared?: number;
  recent?: { wallet: string; seconds: number; at: number }[];
  meta: { id: number; name: string; image: string };
  leaderboard: { rank: number; wallet: string; seconds: number; moves: number }[];
  yesterday: { date: string; tokenId: number; winner: { wallet: string; seconds: number } | null };
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function useCountdown(target: number | undefined) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!target) return;
    const t = () => setLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    t();
    const i = setInterval(t, 1000);
    return () => clearInterval(i);
  }, [target]);
  if (left === null) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`;
}

function useCotd() {
  const [data, setData] = useState<CotdView | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/cotd", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CotdView>) : Promise.reject(new Error("bad"))))
      .then((d) => live && setData(d))
      .catch(() => live && setErr(true));
    return () => { live = false; };
  }, []);
  return { data, err };
}

// Today's featured Portal with a countdown. `full` shows the whole leaderboard (Hall page);
// `hideActions` drops the buttons when the page around it already has them.
export default function CotdCard({ full = false, hideActions = false }: { full?: boolean; hideActions?: boolean }) {
  const { data, err } = useCotd();
  const clock = useCountdown(data?.nextUtc);

  if (err) return null;
  if (!data)
    return (
      <section className="cotd-card" aria-busy>
        <p className="text-[14px] text-mute" role="status">Loading today's Portal…</p>
      </section>
    );
  const top = full ? data.leaderboard : data.leaderboard.slice(0, 3);

  return (
    <section className="cotd-card" aria-label="Portal of the day">
      <div className="flex gap-4">
        <div className="relative aspect-square w-[104px] shrink-0 overflow-hidden rounded-2xl border-2 border-portal/60 shadow-[0_14px_40px_-14px_rgba(131,110,249,0.9)] [container-type:inline-size] sm:w-[140px]">
          <PortalArt src={data.meta.image} tokenId={data.meta.id} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Portal of the day</p>
          <h2 className="mt-0.5 truncate text-[26px] font-extrabold leading-tight tracking-tight text-white">{portalLabel(data.meta.id)}</h2>
          <p className="mt-1 text-[13px] leading-snug text-text2">
            One shared board. One ranked try per wallet; the fastest clear wins this Portal. New Portal in{" "}
            <b className="tabular-nums text-white">{clock || "--:--:--"}</b>
          </p>
          {!hideActions && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/cotd" className="btn-main !px-5 !py-2.5 text-[15px]">Play ranked</Link>
              <Link href={`/judge?id=${data.meta.id}`} className="btn-ghost">Practice it</Link>
            </div>
          )}
        </div>
      </div>

      {!full && (
        <p className="mt-4 text-[13px] text-text2" data-testid="cleared-today">
          <b className="text-white">{data.cleared ?? 0}</b> ranked {(data.cleared ?? 0) === 1 ? "clear" : "clears"} today
          {data.recent && data.recent.length > 0 && (
            <> · latest: {data.recent.slice(0, 3).map((r) => `${r.wallet} in ${fmt(r.seconds)}`).join(", ")}</>
          )}
        </p>
      )}

      <div className="mt-4 grid gap-4 border-t border-edge pt-4 text-[14px] sm:grid-cols-2">
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-mute">
            Fastest today · {data.attempts} {data.attempts === 1 ? "try" : "tries"}
          </h3>
          {top.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-edge2 px-3 py-2.5 text-text2">
              <b className="text-white">The top spot is open.</b> Nobody has cleared it yet. Be first.
            </p>
          ) : (
            <ol className="mt-1 space-y-1">
              {top.map((r) => (
                <li key={r.rank} className="flex justify-between gap-3 tabular-nums">
                  <span className="text-white">{r.rank}. {r.wallet}</span>
                  <span className="text-[#cfc9ea]">{fmt(r.seconds)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-mute">Yesterday's winner</h3>
          <p className="mt-1 text-[#cfc9ea]">
            {data.yesterday.winner ? (
              <><span className="text-white">{data.yesterday.winner.wallet}</span> cleared Portal #{data.yesterday.tokenId} in {fmt(data.yesterday.winner.seconds)}</>
            ) : (
              <>No winner for Portal #{data.yesterday.tokenId}.</>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
