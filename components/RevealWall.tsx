"use client";
import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import { getOwnedPortalMetas } from "./deps";
import { useWallet } from "./useWallet";
import StreakChip, { readWallet, rememberWallet, type KnownWallet } from "./StreakChip";

const TOTAL = 500;
type Wall = { total: number; cleared: number[] };
type Tab = "mine" | "all";

// The faint art for every cell comes from one small picture of all 500 Portals
// (public/wall-mosaic.webp, 25 per row). Cleared Portals load their own full picture on top.
const MOSAIC_COLS = 25;
const MOSAIC_ROWS = Math.ceil(TOTAL / MOSAIC_COLS);
function mosaicSpot(id: number): string {
  const i = id - 1;
  const x = ((i % MOSAIC_COLS) / (MOSAIC_COLS - 1)) * 100;
  const y = (Math.floor(i / MOSAIC_COLS) / (MOSAIC_ROWS - 1)) * 100;
  return `${x.toFixed(3)}% ${y.toFixed(3)}%`;
}

// One cell. Every cell links to that Portal in Judge mode, so the wall doubles as a picker.
const Cell = memo(function Cell({ id, cleared, owned }: { id: number; cleared: boolean; owned: boolean }) {
  const label = cleared ? `Portal ${id}, cleared` : owned ? `Portal ${id}, not cleared yet` : `Portal ${id}`;
  return (
    <Link
      href={`/judge?id=${id}`}
      prefetch={false}
      className={`wall-cell ${cleared ? "wall-cleared" : ""} ${owned ? "wall-owned" : ""}`}
      title={cleared ? `#${id}, cleared` : `#${id}, play it`}
      aria-label={label}
      style={{ backgroundPosition: `0 0, ${mosaicSpot(id)}` }}
    >
      {cleared && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/portals/${id}.webp`} alt="" loading="lazy" decoding="async" width={64} height={64} />
      )}
    </Link>
  );
});

export default function RevealWall() {
  const { address, connect, busy, error } = useWallet();
  const [wall, setWall] = useState<Wall | null>(null);
  const [wallErr, setWallErr] = useState(false);
  const [known, setKnown] = useState<KnownWallet | null>(null);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    let live = true;
    fetch("/api/wall", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Wall>) : Promise.reject(new Error("bad"))))
      .then((d) => live && setWall(d))
      .catch(() => live && setWallErr(true));
    const w = readWallet();
    if (w) { setKnown(w); setTab("mine"); }
    return () => { live = false; };
  }, []);

  // A wallet connected on this page replaces the remembered one.
  useEffect(() => {
    if (!address) return;
    let live = true;
    getOwnedPortalMetas(address)
      .then((m) => {
        if (!live) return;
        const ids = m.map((c) => c.id);
        rememberWallet(address, ids);
        setKnown({ address, ids });
        setTab("mine");
      })
      .catch(() => { /* keep whatever we had */ });
    return () => { live = false; };
  }, [address]);

  const cleared = useMemo(() => new Set(wall?.cleared ?? []), [wall]);
  const owned = useMemo(() => new Set(tab === "mine" ? known?.ids ?? [] : []), [tab, known]);
  const mineCleared = (known?.ids ?? []).filter((id) => cleared.has(id)).length;
  const ids = useMemo(() => Array.from({ length: TOTAL }, (_, i) => i + 1), []);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">All 500 Portals</p>
          <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Reveal wall</h1>
        </div>
        <Link href="/hall" className="link text-sm">Hall of Portals →</Link>
      </div>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-text2">
        Every Portal waits here under a dark cover. When anyone clears a Portal on its daily board, it lights up in full colour. Tap any Portal to play it.
      </p>

      <div className="mt-5 flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} className={`btn-ghost ${tab === "mine" ? "btn-on" : ""}`} onClick={() => setTab("mine")}>My Portals</button>
        <button role="tab" aria-selected={tab === "all"} className={`btn-ghost ${tab === "all" ? "btn-on" : ""}`} onClick={() => setTab("all")}>Everyone</button>
      </div>

      <div className="card mt-4 p-4 sm:p-5" role="status">
        {wallErr ? (
          <p className="text-boom">Could not read the wall right now. Refresh to try again.</p>
        ) : !wall ? (
          <p className="text-mute">Counting cleared Portals…</p>
        ) : tab === "all" ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="font-display text-[34px] font-extrabold leading-none tabular-nums text-white">{wall.cleared.length} <span className="text-lg font-semibold text-mute">of {wall.total.toLocaleString()} cleared</span></p>
              {wall.cleared.length === 0 && <Link href="/play" className="btn-main !py-2 text-[15px]">Clear the first one</Link>}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink2" aria-hidden>
              <div className="h-full rounded-full bg-gradient-to-r from-portal to-mint" style={{ width: `${Math.max(0.6, (wall.cleared.length / wall.total) * 100)}%` }} />
            </div>
            <p className="mt-2 text-[13px] text-mute">
              {wall.cleared.length === 0 ? "None yet. The first daily clear lights up the wall." : "A Portal counts once any daily board of it has been cleared."}
            </p>
          </>
        ) : known && known.ids.length > 0 ? (
          <>
            <p className="font-display text-[34px] font-extrabold leading-none tabular-nums text-white">{mineCleared} <span className="text-lg font-semibold text-mute">of your {known.ids.length} cleared</span></p>
            <p className="mt-1 text-[13px] text-mute">Your Portals are outlined. Faint ones are still waiting for you.</p>
            <StreakChip className="mt-3" />
          </>
        ) : known ? (
          <p className="text-[14px] text-[#cfc9ea]">This wallet holds no Portals yet. The Everyone tab still shows the whole wall.</p>
        ) : (
          <div>
            <p className="text-[14px] text-[#cfc9ea]">Connect your wallet to see your own Portals on the wall. No wallet? The Everyone tab works without one.</p>
            <button className="btn-main mt-3 !py-2" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
            {error && <p className="mt-2 text-[13px] text-boom" role="alert">{error}</p>}
          </div>
        )}
      </div>

      <div className="wall-grid mt-4" aria-label="All 500 Portals">
        {ids.map((id) => (
          <Cell key={id} id={id} cleared={cleared.has(id)} owned={owned.has(id)} />
        ))}
      </div>
    </>
  );
}
