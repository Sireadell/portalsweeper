"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Board, PortalMeta } from "@/lib/types";
import type { Move } from "@/lib/game";
import type { LiveState } from "@/lib/live";
import { getOwnedPortalMetas } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import { useWallet } from "@/components/useWallet";
import PortalArt from "@/components/PortalArt";
import GameScreen from "@/components/GameScreen";
import BoardSkeleton from "@/components/BoardSkeleton";
import StreakChip, { rememberWallet } from "@/components/StreakChip";

export default function PlayPage() {
  const { address, error, busy, connect, disconnect } = useWallet();
  const [portals, setPortals] = useState<PortalMeta[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [picked, setPicked] = useState<PortalMeta | null>(null);
  const [board, setBoard] = useState<{ board: Board; live: LiveState } | null>(null);
  const [boardErr, setBoardErr] = useState(false);
  const date = todayUTC();

  useEffect(() => {
    if (!address) return;
    let live = true;
    setPortals(null);
    setLoadErr(false);
    getOwnedPortalMetas(address)
      .then((m) => { if (live) { setPortals(m); rememberWallet(address, m.map((c) => c.id)); } })
      .catch(() => live && setLoadErr(true));
    return () => { live = false; };
  }, [address]);

  // The server builds today's board (it holds the salt) and keeps its mines: the browser gets a
  // covered board and the game so far, then sends each move back.
  useEffect(() => {
    if (!picked) return;
    let live = true;
    setBoard(null);
    setBoardErr(false);
    fetch(`/api/board?token=${picked.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ board: Board; live: LiveState }>) : Promise.reject(new Error("bad"))))
      .then((b) => live && setBoard(b))
      .catch(() => live && setBoardErr(true));
    return () => { live = false; };
  }, [picked, date]);

  async function move(m: Move): Promise<LiveState> {
    const r = await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: picked!.id, move: m }),
    });
    if (!r.ok) throw new Error("move failed");
    return (await r.json()).live as LiveState;
  }

  return (
    <main className="page">
      {address && (
        <header className="mb-5 flex items-center justify-end gap-3">
          <button onClick={disconnect} className="btn-ghost" title="Disconnect wallet">
            {address.slice(0, 6)}…{address.slice(-4)} · Disconnect
          </button>
        </header>
      )}

      {address && portals && portals.length > 0 && (
        <StreakChip address={address} ids={portals.map((c) => c.id)} className="mb-4" />
      )}

      {!address && (
        <section className="card mx-auto mt-6 max-w-[620px] overflow-hidden text-center">
          <div className="flex justify-center -space-x-4 bg-gradient-to-b from-portal/20 to-transparent px-6 pb-2 pt-8" aria-hidden>
            {[100, 7, 9].map((id, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={id} src={`/portals/${id}.webp`} alt="" width={88} height={88}
                className="h-[88px] w-[88px] rounded-2xl border-4 border-panel object-cover shadow-xl"
                style={{ transform: `rotate(${(i - 1) * 8}deg) translateY(${i === 1 ? -6 : 0}px)`, zIndex: i === 1 ? 2 : 1 }} />
            ))}
          </div>
          <div className="px-5 pb-7 pt-3 sm:px-8">
            <h1 className="text-[32px] font-extrabold tracking-tight text-white">Play your own Portals</h1>
            <p className="mx-auto mt-2 max-w-[44ch] text-[15px] leading-relaxed text-text2">Connect the wallet that holds your Portals. Each Portal gets one ranked board every day, and your clears go on the reveal wall.</p>
            <button className="btn-main btn-lg mt-6" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
            {error && <p className="mt-3 text-[14px] text-boom" role="alert">{error}</p>}
            <p className="mt-6 text-[14px] text-mute">No wallet? <Link href="/judge" className="link">Try Judge mode</Link>, it works with any Portal.</p>
          </div>
        </section>
      )}

      {address && !picked && (
        <section className="mx-auto max-w-[760px]">
          <h1 className="text-[28px] font-extrabold tracking-tight text-white">Pick your Portal</h1>
          <p className="mt-1 text-[14px] text-mute">Each Portal has one ranked board per day. Pick one to play today's.</p>
          {!portals && !loadErr && <p className="mt-6 text-[14px] text-mute" role="status">Looking for your Portals…</p>}
          {loadErr && <p className="mt-6 text-[14px] text-boom" role="alert">Could not read your Portals right now. Refresh to try again.</p>}
          {portals && portals.length === 0 && (
            <div className="mt-6 rounded-2xl border border-edge bg-panel p-5">
              <p className="text-white">This wallet holds no Portals yet. Win a Portal of the day to get your first one.</p>
              <p className="mt-1 text-[14px] text-mute">You can still try any Portal in practice, no wallet needed.</p>
              <Link href="/judge" className="btn-main mt-4 inline-block">Try Judge mode</Link>
            </div>
          )}
          {portals && portals.length > 0 && (
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {portals.map((c) => (
                <li key={c.id}>
                  <button className="pick-card" onClick={() => setPicked(c)}>
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl [container-type:inline-size]">
                      <PortalArt src={c.image} tokenId={c.id} className="h-full w-full" />
                    </div>
                    <span className="mt-2 block truncate text-sm font-semibold text-white">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {address && picked && (
        <>
          <button className="btn-ghost mb-4" onClick={() => setPicked(null)}>← Switch Portal</button>
          {board ? <GameScreen meta={picked} board={board.board} live={board.live} remote={move} mode="daily" address={address} /> : boardErr ? (
            <p className="text-boom" role="alert">Could not load today's board. Check your connection and press Switch Portal, then pick again.</p>
          ) : <BoardSkeleton text="Loading today's board…" />}
        </>
      )}
    </main>
  );
}
