"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "portalsweeper:wallet";
export type KnownWallet = { address: string; ids: number[] };

// The wallet connection lives in memory per page, so the play page leaves a note of the wallet
// and its Portals here and the landing page and wall can read it back.
export function rememberWallet(address: string, ids: number[]) {
  try { localStorage.setItem(KEY, JSON.stringify({ address, ids })); } catch { /* storage may be blocked */ }
}
export function forgetWallet() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export function readWallet(): KnownWallet | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? "null") as KnownWallet | null;
    return w && typeof w.address === "string" && Array.isArray(w.ids) ? w : null;
  } catch {
    return null;
  }
}

type Streak = { current: number; best: number; clearedToday: boolean; atRisk: boolean };

export function useStreak(w: KnownWallet | null) {
  const [s, setS] = useState<Streak | null>(null);
  const key = w ? `${w.address}|${w.ids.join(",")}` : "";
  useEffect(() => {
    if (!w || w.ids.length === 0) { setS(null); return; }
    let live = true;
    fetch(`/api/streak?address=${w.address}&ids=${w.ids.slice(0, 300).join(",")}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Streak>) : Promise.reject(new Error("bad"))))
      .then((d) => live && setS(d))
      .catch(() => live && setS(null));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

// Current and best daily streak for a wallet. Pass address and ids on the play page; on other
// pages leave them out and it uses the wallet remembered from the last visit.
export default function StreakChip({ address, ids, className = "" }: { address?: string | null; ids?: number[]; className?: string }) {
  const [known, setKnown] = useState<KnownWallet | null | undefined>(undefined);
  const idKey = ids ? ids.join(",") : "";
  useEffect(() => {
    if (address && ids) setKnown({ address, ids });
    else setKnown(readWallet());
  }, [address, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useStreak(known ?? null);

  if (known === undefined) return null;
  if (!known || known.ids.length === 0 || !s) {
    if (known && known.ids.length > 0) return null;
    return (
      <p className={`text-[13px] text-mute ${className}`}>
        Clear a ranked board each UTC day to build a streak. <Link href="/play" className="text-mint underline-offset-2 hover:underline">Connect a wallet</Link> to start one.
      </p>
    );
  }
  const nudge = s.atRisk
    ? "Clear today to keep it."
    : s.clearedToday
      ? "Cleared today. Come back after 00:00 UTC."
      : s.current === 0 ? "Clear a board today to start one." : "";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-panel px-3 py-2 ${s.atRisk ? "border-boom" : "border-edge"} ${className}`} role="status">
      <span className="text-[15px] font-bold text-white tabular-nums">Streak {s.current} {s.current === 1 ? "day" : "days"}</span>
      <span className="text-[13px] text-mute tabular-nums">Best {s.best}</span>
      {nudge && <span className={`text-[13px] ${s.atRisk ? "font-semibold text-boom" : "text-[#cfc9ea]"}`}>{nudge}</span>}
    </div>
  );
}
