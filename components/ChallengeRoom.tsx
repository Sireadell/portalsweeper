"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Board, PortalMeta } from "@/lib/types";
import type { Move } from "@/lib/game";
import type { LiveState } from "@/lib/live";
import type { ChallengeView, ChallengePlayerView, ChallengeReason } from "@/lib/challenge";
import { challengePlayMessage } from "@/lib/challenge-message";
import { useWallet } from "./useWallet";
import { signText } from "./signing";
import GameScreen from "./GameScreen";
import PortalArt from "./PortalArt";
import { portalLabel } from "@/lib/names";
import { blockLink } from "@/lib/types";
import { PotDisplay } from "./StakePanel";
import { sendAndLockStake } from "./stakeLock";
import { stakesEnabled } from "@/lib/stakesFlag";
import type { stakeView } from "@/lib/challengeStakes";

type Stake = ReturnType<typeof stakeView>;

type View = ChallengeView;
type Info = { id: number; name: string; image: string };
type Game = { board: Board; live: LiveState; meta: PortalMeta; sig: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const short = (w: string | null) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "Waiting");

const REASON: Record<ChallengeReason, string> = {
  faster: "Both cleared the board. The faster clear wins.",
  "opponent-lost": "One cleared the board and the other hit a mine.",
  forfeit: "One cleared the board and the other did not finish in time.",
  draw: "Nobody cleared the board, so nobody wins.",
  expired: "Nobody took the second seat before the link ran out.",
};

function outcomeText(p: ChallengePlayerView): string {
  if (!p.joined) return "Never started";
  if (!p.finished) return "Did not finish";
  return p.won ? `Cleared in ${fmt(p.seconds ?? 0)}` : "Hit a mine";
}

// Loads the challenge and keeps it fresh every few seconds until the result is settled.
function usePoll(id: string) {
  const [view, setView] = useState<View | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [stake, setStake] = useState<Stake | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/challenge?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.status === 404) return setMissing(true);
      if (!r.ok) return;
      const j = await r.json();
      setView(j.challenge);
      setInfo(j.meta);
      setStake(j.stake ?? null);
    } catch { /* the next poll tries again */ }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const settled = view?.settled ?? false;
  useEffect(() => {
    if (settled) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [settled, load]);
  return { view, setView, info, missing, stake, setStake };
}

export default function ChallengeRoom({ id }: { id: string }) {
  const { address, error, busy, connect, disconnect } = useWallet();
  const [game, setGame] = useState<Game | null>(null);
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const { view, setView, info, missing, stake, setStake } = usePoll(id);
  const [locking, setLocking] = useState(false);

  async function start() {
    if (!address) return;
    setMsg("");
    setSigning(true);
    let sig: string;
    try {
      sig = await signText(challengePlayMessage(id), address);
    } catch {
      setMsg("No signature was given, so no try was started. Press Start to try again.");
      setSigning(false);
      return;
    }
    try {
      const r = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", id, address, signature: sig }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not start.");
      setView(j.challenge);
      setGame({ board: j.board, live: j.live, meta: j.meta, sig });
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setSigning(false);
    }
  }

  async function lock() {
    if (!address || !stake?.escrow) return;
    setMsg("");
    setLocking(true);
    try {
      const j = await sendAndLockStake({ challengeId: id, wallet: address, escrow: stake.escrow, stakeTpot: stake.stakeTpot });
      setStake(j as Stake);
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "Could not lock the stake.");
    } finally {
      setLocking(false);
    }
  }

  // Every move goes to the server, which keeps the mines and the clock. The move that ends the game
  // records it there, and the answer carries the challenge so the result can show at once.
  async function move(m: Move): Promise<LiveState> {
    if (!game || !address) throw new Error("no game");
    const res = await fetch("/api/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", id, address, signature: game.sig, move: m }),
    });
    const j = await res.json();
    if (!res.ok) {
      setFailed(j.error ?? "Could not play that move.");
      throw new Error(j.error);
    }
    if (j.challenge) setView(j.challenge);
    if (j.stake) setStake(j.stake);
    return j.live as LiveState;
  }

  if (missing)
    return (
      <main className="page-narrow">
        <h1 className="text-2xl font-bold text-white">That challenge link does not exist.</h1>
        <p className="mt-2 text-text2">Check the link, or make a new challenge.</p>
        <Link className="btn-main mt-5" href="/challenge">Challenge a friend</Link>
      </main>
    );
  if (!view || !info)
    return (
      <main className="page-narrow" aria-busy>
        <p className="text-[14px] text-mute" role="status">Loading the challenge…</p>
      </main>
    );

  const me = address?.toLowerCase() ?? null;
  const mine = view.players.find((p) => p.joined && p.wallet === me);
  const iAmCreator = me !== null && view.players[0].wallet === me;
  const myDone = !!mine?.finished;

  const showStake = stakesEnabled() && !!stake;
  const myLock = !!stake && !!me && stake.locks.some((l) => l.wallet === me);
  const bothLocked = stake?.status === "locked";
  const footer = (
    <ChallengeStatus view={view} me={me} failed={failed} stake={showStake ? stake : null} />
  );

  return (
    <main className="page">
      {address && (
        <header className="mb-5 flex items-center justify-end gap-3">
          <button onClick={disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
        </header>
      )}

      {game ? (
        <GameScreen meta={game.meta} board={game.board} live={game.live} remote={move} mode="challenge" address={address} footer={footer} />
      ) : (
        <section className="mx-auto max-w-[720px] pt-2">
          <p className="eyebrow">Friend challenge</p>
          <h1 className="mb-5 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">
            {view.settled ? "Challenge result" : iAmCreator ? "Send this link to a friend" : "You have been challenged"}
          </h1>

          <div className="cotd-card">
            <div className="flex gap-4">
              <div className="relative aspect-square w-[88px] shrink-0 overflow-hidden rounded-2xl border-2 border-portal/60 [container-type:inline-size] sm:w-[110px]">
                <PortalArt src={info.image} tokenId={info.id} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Same hidden board for both</p>
                <h2 className="mt-0.5 truncate text-[24px] font-extrabold leading-tight tracking-tight text-white">{portalLabel(info.id)}</h2>
                <p className="mt-1 text-[13px] leading-snug text-text2">
                  One try each. The server keeps the mines and the clock. The faster clear wins, and a mine loses.
                </p>
              </div>
            </div>
          </div>

          {view.settled ? (
            <ChallengeResult view={view} me={me} stake={showStake ? stake : null} />
          ) : (
            <>
              <InviteLink />
              {showStake && stake && <PotDisplay stakeTpot={stake.stakeTpot} potTpot={stake.potTpot} locked={stake.locks.length} />}
              <div className="card mt-4 p-5 text-center sm:p-6">
                {myDone ? (
                  <p className="text-[15px] text-text2">Your try is done. <b className="text-white">Waiting for the other player to finish.</b> This page updates by itself.</p>
                ) : !address ? (
                  <>
                    <p className="text-[15px] text-text2">
                      {iAmCreator || view.status === "open" ? "Connect your wallet to take your try." : "Connect your wallet to find your seat."}
                    </p>
                    <button className="btn-main btn-lg mt-4" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
                    {error && <p className="mt-3 text-[14px] text-boom" role="alert">{error}</p>}
                  </>
                ) : view.status === "expired" ? (
                  <p className="text-[15px] text-text2">This challenge ran out before a second player joined.</p>
                ) : showStake && stake && stake.status === "open" && !myLock ? (
                  <>
                    <p className="text-[15px] text-text2">
                      This challenge has a stake. Put up <b className="text-white">{stake.stakeTpot} tPOT</b> to play. Nobody plays until both of you have. The winner takes the pot. Testnet tPOT, no value.
                    </p>
                    <button className="btn-main btn-lg mt-4" onClick={lock} disabled={locking || !stake.escrow}>
                      {locking ? "Check your wallet…" : `Lock ${stake.stakeTpot} tPOT`}
                    </button>
                  </>
                ) : showStake && stake && !bothLocked && !mine ? (
                  <p className="text-[15px] text-text2">Your stake is locked. <b className="text-white">Waiting for the other player to lock theirs.</b> This page updates by itself, then you can start.</p>
                ) : (
                  <>
                    <p className="text-[14px] text-mute">
                      You get one try. Your wallet signs a short message (free, no transaction). The clock starts at your first tap and the server keeps it. If you leave, press Start again to pick the try back up, but the clock keeps running.
                    </p>
                    <button className="btn-main btn-lg mt-4" onClick={start} disabled={signing}>
                      {signing ? "Check your wallet…" : mine ? "Pick my try back up" : iAmCreator ? "Start my try" : "Accept the challenge"}
                    </button>
                  </>
                )}
                {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
              </div>
              <Seats view={view} me={me} />
            </>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3 text-[14px]">
            <Link href="/challenge" className="text-mint underline-offset-2 hover:underline">Make a new challenge</Link>
            <Link href="/cotd" className="text-mint underline-offset-2 hover:underline">Portal of the day</Link>
          </div>
        </section>
      )}
    </main>
  );
}

function InviteLink() {
  const [note, setNote] = useState("");
  const link = () => window.location.href;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setNote("Link copied. Send it to your friend.");
    } catch {
      setNote(link());
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Portalsweeper challenge", text: "I challenge you to a Portalsweeper board. Same mines, fastest clear wins.", url: link() });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }
  return (
    <div className="card mt-4 p-4 sm:p-5">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-mute">Challenge link</h3>
      <input className="field mt-2 text-[14px]" readOnly value={typeof window === "undefined" ? "" : window.location.href} onFocus={(e) => e.currentTarget.select()} aria-label="Challenge link" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-main !px-5 !py-2.5 text-[15px]" onClick={share}>Share challenge</button>
        <button type="button" className="btn-ghost" onClick={copy}>Copy link</button>
      </div>
      {note && <p className="mt-2 break-all text-[12px] text-mute" role="status">{note}</p>}
    </div>
  );
}

function Seats({ view, me }: { view: View; me: string | null }) {
  return (
    <section className="card mt-4 p-4 sm:p-5" aria-label="Players">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-mute">Players</h3>
      <ul className="mt-2 space-y-1.5 text-[14px]">
        {view.players.map((p) => (
          <li key={p.role} className="flex justify-between gap-3">
            <span className="text-white">
              {p.role === "creator" ? "Challenger" : "Friend"} · {short(p.wallet)}{p.wallet && p.wallet === me ? " (you)" : ""}
            </span>
            <span className="text-[#D4CCBF]">{!p.joined ? (p.role === "creator" ? "Not started" : "Seat open") : p.finished ? "Finished" : "Playing"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Shown under the board while playing, and once the result is in.
function ChallengeStatus({ view, me, failed, stake }: { view: View; me: string | null; failed: string | null; stake: Stake | null }) {
  return (
    <section className="cotd-card mt-4" role="status" aria-live="polite">
      {failed ? (
        <p className="text-boom">{failed}</p>
      ) : view.settled ? (
        <ChallengeResult view={view} me={me} stake={stake} compact />
      ) : view.players.some((p) => p.wallet === me && p.finished) ? (
        <p className="text-white">Your try is done. <b>Waiting for the other player to finish.</b> The result shows here by itself.</p>
      ) : (
        <p className="text-text2">One try, timed by the server. The faster clear wins.</p>
      )}
    </section>
  );
}

// The V3 testnet has no transaction explorer, so a payout links to its block in the Node Console and
// always shows the transaction hash.
function TxRef({ label, tx, block }: { label: string; tx: string; block?: number | null }) {
  return (
    <span className="mr-3 break-all">
      {block != null ? <a className="text-mint underline-offset-2 hover:underline" href={blockLink(block)} target="_blank" rel="noreferrer">{label}</a> : label}
      <span className="ml-1 text-[12px] text-mute">{tx.slice(0, 10)}…{tx.slice(-6)}</span>
    </span>
  );
}

function StakeResult({ stake }: { stake: Stake }) {
  const paid = stake.status === "settled" && stake.payoutTx;
  const refunded = stake.status === "refunded";
  return (
    <div className="mt-4 rounded-xl border border-edge bg-ink2 px-3 py-2.5 text-[14px] text-text2" data-testid="stake-result">
      <p>
        Stake: <b className="text-white">{stake.stakeTpot} tPOT</b> each · Pot: <b className="text-white">{stake.potTpot} tPOT</b>
      </p>
      {paid && stake.payoutTx && (
        <p className="mt-1">Paid to {short(stake.winner)}. <TxRef label="Payout transaction" tx={stake.payoutTx} block={stake.payoutBlock} /></p>
      )}
      {refunded && (
        <p className="mt-1">
          {stake.refundTxs.length ? "Stakes returned to the wallets they came from. " : "Nothing was locked, so nothing moved. "}
          {stake.refundTxs.map((t, i) => <TxRef key={t} label={`Refund ${i + 1}`} tx={t} block={stake.refundBlocks[i]} />)}
        </p>
      )}
      {!paid && !refunded && <p className="mt-1">The payout is on its way. This page updates by itself.</p>}
      <p className="mt-1 text-[12px] text-mute">{stake.note}</p>
    </div>
  );
}

export function ChallengeResult({ view, me, stake = null, compact = false }: { view: View; me: string | null; stake?: Stake | null; compact?: boolean }) {
  const [note, setNote] = useState("");
  const iPlayed = view.players.some((p) => p.wallet === me);
  const headline = !view.winner
    ? view.reason === "expired" ? "Challenge expired" : "Draw"
    : view.winner === me ? "You won" : iPlayed ? "You lost" : `${short(view.winner)} won`;
  const win = view.winner && view.winner === me;
  const text = `${headline}: Portalsweeper friend challenge on ${portalLabel(view.tokenId)}.`;

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Portalsweeper challenge result", text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setNote("Result copied. Paste it anywhere.");
    } catch {
      setNote(url);
    }
  }

  return (
    <section className={compact ? "" : win ? "reveal-card mt-4" : "card mt-4 p-5"} data-testid="challenge-result" aria-live="polite">
      <p className="eyebrow">{view.reason ? REASON[view.reason] : ""}</p>
      <h3 className={`mt-1 font-extrabold leading-none tracking-tight text-white ${compact ? "text-[26px]" : "text-[34px]"}`} data-testid="challenge-headline">{headline}</h3>
      <ul className="mt-4 space-y-2">
        {view.players.map((p) => (
          <li key={p.role} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[14px] ${p.wallet && p.wallet === view.winner ? "border-mint/60 bg-mint/10" : "border-edge bg-ink2"}`}>
            <span className="min-w-0 truncate text-white">
              {p.wallet && p.wallet === view.winner ? "🏆 " : ""}{p.role === "creator" ? "Challenger" : "Friend"} · {short(p.wallet)}{p.wallet && p.wallet === me ? " (you)" : ""}
            </span>
            <span className="shrink-0 tabular-nums text-[#D4CCBF]">{outcomeText(p)}{p.finished && p.won && p.moves ? ` · ${p.moves} moves` : ""}</span>
          </li>
        ))}
      </ul>
      {stake && <StakeResult stake={stake} />}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-main !px-5 !py-2.5 text-[15px]" onClick={share}>Share result</button>
        <Link href="/challenge" className="btn-ghost">Challenge someone else</Link>
      </div>
      {note && <p className="mt-2 break-all text-[12px] text-mute" role="status">{note}</p>}
    </section>
  );
}
