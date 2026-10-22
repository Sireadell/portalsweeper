"use client";
import Link from "next/link";
import { useState } from "react";
import type { Board, PortalMeta } from "@/lib/types";
import { useWallet } from "@/components/useWallet";
import GameScreen from "@/components/GameScreen";
import CotdCard from "@/components/CotdCard";
import { cotdMessage } from "@/lib/cotd-message";
import { todayUTC } from "@/components/dailySalt";
import { generateBoard, getPortalMeta } from "@/components/deps";
import { newPracticeSalt } from "@/lib/practice";

type Phase = "ready" | "signing" | "playing";
type Result = { rank: number | null; won: boolean; top?: number | null; mine?: number } | { error: string };
type Eth = { request(a: { method: string; params: unknown[] }): Promise<string> };

function toHex(s: string): string {
  return "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function CotdPage() {
  const { address, error, busy, connect, disconnect } = useWallet();
  const [phase, setPhase] = useState<Phase>("ready");
  const [msg, setMsg] = useState("");
  const [game, setGame] = useState<{ board: Board; meta: PortalMeta; date: string; sig: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [free, setFree] = useState<{ board: Board; meta: PortalMeta; round: number } | null>(null);

  async function start() {
    if (!address) return;
    setMsg("");
    setPhase("signing");
    let sig: string;
    try {
      const eth = window.ethereum as unknown as Eth;
      sig = await eth.request({ method: "personal_sign", params: [toHex(cotdMessage(todayUTC())), address] });
    } catch {
      setMsg("No signature was given, so no try was started. Press Start to try again.");
      setPhase("ready");
      return;
    }
    try {
      const r = await fetch("/api/cotd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", address, signature: sig }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error ?? "Could not start.");
        setPhase("ready");
        return;
      }
      setGame({ board: j.board, meta: j.meta, date: j.board.date, sig });
      setPhase("playing");
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
      setPhase("ready");
    }
  }

  // Unranked try for visitors without a wallet. Uses a random practice salt and never calls the ranked API.
  async function startFree() {
    setMsg("");
    try {
      const today = await fetch("/api/cotd", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))));
      const meta = await getPortalMeta(today.tokenId);
      setFree({ meta, board: generateBoard(meta, today.date, newPracticeSalt()), round: (free?.round ?? 0) + 1 });
    } catch {
      setMsg("Could not load today's Portal. Try again.");
    }
  }

  async function finish(r: { won: boolean; seconds: number; moves: number }) {
    if (!game || !address) return;
    try {
      const res = await fetch("/api/cotd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finish", address, signature: game.sig, date: game.date, ...r }),
      });
      const j = await res.json();
      let top: number | null = null;
      if (res.ok && r.won) {
        try {
          const t = await fetch("/api/cotd", { cache: "no-store" }).then((x) => x.json());
          top = t.leaderboard?.[0]?.seconds ?? null;
        } catch { /* the rank line still shows */ }
      }
      setResult(res.ok ? { rank: j.rank, won: r.won, top, mine: r.seconds } : { error: j.error ?? "Could not record the result." });
    } catch {
      setResult({ error: "Could not reach the server to record your result." });
    }
  }

  const footer = result && (
    <section className="cotd-card mt-4" role="status">
      {"error" in result ? (
        <p className="text-boom">{result.error}</p>
      ) : result.won ? (
        <p className="text-white">
          Recorded. {result.rank ? <>You are <b>#{result.rank}</b> on today's board.</> : "Your time is on the board."}{" "}
          {result.top != null && result.mine != null && (
            result.rank === 1
              ? <>You hold the top time today. </>
              : <>Top time today is {Math.floor(result.top / 60)}:{String(Math.floor(result.top % 60)).padStart(2, "0")}, you were {Math.max(0, Math.round(result.mine - result.top))}s behind. </>
          )}
          <Link href="/hall" className="text-mint underline-offset-2 hover:underline">See the Hall</Link>
        </p>
      ) : (
        <p className="text-white">
          Your ranked try is used. Come back for tomorrow's Portal.{" "}
          <Link href="/hall" className="text-mint underline-offset-2 hover:underline">See the Hall</Link>
        </p>
      )}
    </section>
  );

  return (
    <main className="page">
      {address && (
        <header className="mb-5 flex items-center justify-end gap-3">
          <button onClick={disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
        </header>
      )}

      {phase !== "playing" && !free && (
        <section className="mx-auto max-w-[720px] pt-2">
          <p className="eyebrow">One shared board for everyone</p>
          <h1 className="mb-5 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Portal of the day</h1>
          <CotdCard hideActions />
          <div className="card mt-4 p-5 text-center sm:p-6">
            {!address ? (
              <>
                <p className="text-[15px] text-text2">Connect any wallet to take today's ranked try. The fastest clear wins this Portal.</p>
                <button className="btn-main btn-lg mt-4" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
                {error && <p className="mt-3 text-[14px] text-boom" role="alert">{error}</p>}
                <div className="mt-5 border-t border-edge pt-5">
                  <p className="text-[14px] text-text2">No wallet? You can still play today's Portal. It will not be ranked.</p>
                  <button className="btn-ghost mt-3" onClick={startFree}>Play today's Portal, unranked</button>
                  {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
                  <p className="mt-3 text-[14px] text-mute">
                    Or try <Link href="/judge" className="text-mint underline-offset-2 hover:underline">Judge mode</Link> with any Portal.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="text-[14px] text-mute">
                  You get one ranked try. Your wallet signs a short message (free, no transaction) and the clock starts on the server. Leaving the page uses up the try.
                </p>
                <button className="btn-main btn-lg mt-4" onClick={start} disabled={phase === "signing"}>
                  {phase === "signing" ? "Check your wallet…" : "Start my ranked try"}
                </button>
                {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
              </>
            )}
          </div>
        </section>
      )}

      {free && (
        <>
          <GameScreen key={free.round} meta={free.meta} board={free.board} mode="cotd-free" onAgain={startFree} />
          <p className="mt-4 text-center text-[13px] text-mute">
            Unranked try. Connect a wallet for the ranked try that can win this Portal.{" "}
            <button className="text-mint underline-offset-2 hover:underline" onClick={() => setFree(null)}>Back</button>
          </p>
        </>
      )}

      {phase === "playing" && game && (
        <GameScreen meta={game.meta} board={game.board} mode="cotd" address={address} onFinish={finish} footer={footer} />
      )}
    </main>
  );
}
