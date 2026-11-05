"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, PortalMeta } from "@/lib/types";
import type { Move } from "@/lib/game";
import type { LiveState } from "@/lib/live";
import type { ChallengeView, ChallengePlayerView, ChallengeReason, ChallengeBoards } from "@/lib/challenge";
import DuelBoards from "./DuelBoards";
import { challengeCancelMessage, challengePlayMessage } from "@/lib/challenge-message";
import { getMyResult, rememberChallenge, saveMyResult } from "@/lib/myChallenges";
import { useWallet } from "./useWallet";
import { signText } from "./signing";
import GameScreen from "./GameScreen";
import PortalArt from "./PortalArt";
import { portalLabel } from "@/lib/names";
import { blockLink } from "@/lib/types";
import { PotDisplay } from "./StakePanel";
import { sendAndLockPortal, sendAndLockStake } from "./stakeLock";
import { stakesEnabled } from "@/lib/stakesFlag";
import type { stakeView } from "@/lib/challengeStakes";

type Stake = ReturnType<typeof stakeView>;

type View = ChallengeView;
type Info = { id: number; name: string; image: string };
type Game = { board: Board; live: LiveState; meta: PortalMeta; sig: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const short = (w: string | null) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "Waiting");

type Progress = { creator?: number; opponent?: number };

const REASON: Record<ChallengeReason, string> = {
  faster: "Both cleared the board. The faster clear wins.",
  "opponent-lost": "One cleared the board and the other hit a mine.",
  forfeit: "One cleared the board and the other did not finish in time.",
  draw: "Nobody cleared the board, so nobody wins.",
  expired: "Nobody took the second seat before the link ran out.",
  cancelled: "The challenge was cancelled before anyone joined.",
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
  const [progress, setProgress] = useState<Progress | null>(null);
  const [boards, setBoards] = useState<ChallengeBoards | null>(null);
  const skew = useRef(0); // server clock minus this browser's clock, so countdowns match on both screens
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/challenge?id=${encodeURIComponent(id)}&boards=1`, { cache: "no-store" });
      if (r.status === 404) return setMissing(true);
      if (!r.ok) return;
      const j = await r.json();
      setView(j.challenge);
      setInfo(j.meta);
      setStake(j.stake ?? null);
      setProgress(j.progress ?? null);
      setBoards(j.boards ?? null);
      if (typeof j.challenge?.serverNow === "number") skew.current = j.challenge.serverNow - Date.now();
    } catch { /* the next poll tries again */ }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const settled = view?.settled ?? false;
  const playing = view?.status === "playing";
  useEffect(() => {
    if (settled) return;
    const t = setInterval(load, view?.duel ? 1000 : playing ? 2000 : 5000);
    return () => clearInterval(t);
  }, [settled, playing, load, view?.duel]);
  return { view, setView, info, missing, stake, setStake, progress, boards, skew };
}

export default function ChallengeRoom({ id }: { id: string }) {
  const { address, error, busy, connect, disconnect } = useWallet();
  const [game, setGame] = useState<Game | null>(null);
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const { view, setView, info, missing, stake, setStake, progress, boards, skew } = usePoll(id);
  const [, setTick] = useState(0);
  const goAtMs = view?.duel && game ? view.goAt : null;
  const counting = !!view?.duel && !!game && (view.goAt === null || Date.now() + skew.current < view.goAt + 900);
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [counting, goAtMs]);
  const [locking, setLocking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [saved, setSaved] = useState<{ won: boolean; seconds: number } | null>(null);
  useEffect(() => { if (address) setSaved(getMyResult(id, address)); }, [id, address]);
  useEffect(() => {
    const w = address?.toLowerCase();
    if (w && view && view.players.some((p) => p.wallet === w)) rememberChallenge(id, w, view.players[0].wallet === w ? "creator" : "opponent");
  }, [id, address, view]);

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

  async function cancel() {
    if (!address) return;
    if (!window.confirm("Cancel this challenge? The link will stop working for your friend.")) return;
    setMsg("");
    setCancelling(true);
    try {
      const sig = await signText(challengeCancelMessage(id), address);
      const r = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", id, address, signature: sig }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not cancel.");
      setView(j.challenge);
      if (j.stake) setStake(j.stake);
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "No signature was given, so nothing was cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  // Portal stakes: the Portals this wallet holds, to pick one to put up.
  const [myPortals, setMyPortals] = useState<number[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const portalStake = stake?.asset === "portal";
  useEffect(() => {
    if (!address || !portalStake) return;
    let off = false;
    fetch(`/api/portals?owner=${address}`).then((r) => r.json()).then((j: { id: number }[]) => {
      if (off || !Array.isArray(j)) return;
      const ids = j.map((m) => m.id);
      setMyPortals(ids);
      setPick((p) => p ?? ids[0] ?? null);
    }).catch(() => {});
    return () => { off = true; };
  }, [address, portalStake]);

  async function lockPortalStake() {
    if (!address || pick === null) return;
    setMsg("");
    setLocking(true);
    try {
      setStake((await sendAndLockPortal({ challengeId: id, wallet: address, portal: pick })) as Stake);
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "Could not lock the Portal.");
    } finally {
      setLocking(false);
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
    const lv = j.live as LiveState;
    if (lv.status === "won" || lv.status === "lost") {
      const r = { won: lv.status === "won", seconds: lv.elapsed };
      saveMyResult(id, address, r);
      setSaved(r);
    }
    return lv;
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

  const serverNow = Date.now() + skew.current;
  const duelLock =
    !counting ? null
      : view.goAt === null ? { text: "Waiting for your friend to join…", sub: "You both start together after a 3, 2, 1 countdown." }
        : serverNow < view.goAt ? { text: String(Math.max(1, Math.ceil((view.goAt - serverNow) / 1000))), sub: "Get ready" }
          : { text: "Go!" };
  const showStake = stakesEnabled() && !!stake;
  const myLock = !!stake && !!me && stake.locks.some((l) => l.wallet === me);
  const bothLocked = stake?.status === "locked";
  const footer = (
    <ChallengeStatus view={view} me={me} failed={failed} stake={showStake ? stake : null} progress={progress} boards={boards} />
  );

  return (
    <main className="page">
      {address && (
        <header className="mb-5 flex items-center justify-end gap-3">
          <button onClick={disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
        </header>
      )}

      {game ? (
        <GameScreen meta={game.meta} board={game.board} live={game.live} remote={move} mode="challenge" preset={{ twist: "classic", cpu: "off" }} address={address} footer={footer} lock={duelLock} />
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
              <InviteLink id={id} duel={view.duel} />
              {iAmCreator && view.status === "open" && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-mute">
                  <span>Link open until {new Date(view.expiresAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}, then it closes by itself.</span>
                  {address && <button type="button" className="btn-ghost" onClick={cancel} disabled={cancelling}>{cancelling ? "Check your wallet…" : "Cancel this challenge"}</button>}
                </div>
              )}
              {showStake && stake && <PotDisplay stakeTpot={stake.stakeTpot} potTpot={stake.potTpot} locked={stake.locks.length} asset={stake.asset} portals={stake.locks.flatMap((l) => (l.portal ? [l.portal] : []))} />}
              <div className="card mt-4 p-5 text-center sm:p-6">
                {myDone ? (
                  <>
                    {saved && (
                      <p className="font-display text-[22px] font-extrabold text-white">
                        {saved.won ? `You cleared it in ${fmt(saved.seconds)}` : "You hit a mine"}
                      </p>
                    )}
                    <p className="mt-1 text-[15px] text-text2">
                      {view.status === "open"
                        ? <>Your try is done. <b className="text-white">Waiting for your friend to join.</b> The link stays open until {new Date(view.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</>
                        : <>Your try is done. <b className="text-white">Waiting for the other player to finish.</b> This page updates by itself.</>}
                    </p>
                  </>
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
                ) : showStake && stake && stake.asset === "portal" && stake.status === "open" && !myLock ? (
                  <>
                    <p className="text-[15px] text-text2">
                      This race has a Portal stake. Put up one of your Portals to play. Nobody plays until both of you have. <b className="text-white">The winner gets both Portals.</b> A draw or a cancel sends each one back.
                    </p>
                    <p className="mt-2 text-[13px] text-mute" data-testid="portal-custody">Trusted custody: the game server holds staked Portals until the race ends. Testnet Portals. Your wallet also needs a little tPOT for the transfer fee.</p>
                    {myPortals.length ? (
                      <>
                        <div className="mt-3 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Portal to stake">
                          {myPortals.map((p) => (
                            <button key={p} type="button" role="radio" aria-checked={pick === p} className="pick !w-auto px-4" aria-pressed={pick === p} onClick={() => setPick(p)}>
                              <b>#{p}</b>
                            </button>
                          ))}
                        </div>
                        <button className="btn-main btn-lg mt-4" onClick={lockPortalStake} disabled={locking || pick === null || !stake.escrow}>
                          {locking ? "Check your wallet…" : pick === null ? "Pick a Portal" : `Put up Portal #${pick}`}
                        </button>
                      </>
                    ) : (
                      <p className="mt-3 text-[15px] text-boom">This wallet holds no Portal, so it cannot join a Portal stake.</p>
                    )}
                  </>
                ) : showStake && stake && stake.status === "open" && !myLock ? (
                  <>
                    <p className="text-[15px] text-text2">
                      This challenge has a stake. Put up <b className="text-white">{stake.stakeTpot} tPOT</b> to play. Nobody plays until both of you have. The winner takes the pot. Testnet tPOT, no value. Your wallet also needs about 9 tPOT free to open a staked match, or 5 to join one, because the chain charges a storage fee for it.
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
                      {signing ? "Check your wallet…" : mine ? "Pick my try back up" : iAmCreator ? (view.duel ? "I am ready" : "Start my try") : view.duel ? "Accept and race" : "Accept the challenge"}
                    </button>
                  </>
                )}
                {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
              </div>
              {view.duel && <DuelBoards view={view} boards={boards} me={me} progress={progress} />}
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

import QrCode from "./QrCode";
import { toRoomCode } from "@/lib/roomCode";

function InviteLink({ id, duel }: { id: string; duel: boolean }) {
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
  async function copyWatch() {
    const w = `${window.location.origin}/watch/${id}`;
    try {
      await navigator.clipboard.writeText(w);
      setNote("Watch link copied. Anyone can follow the race with it, no wallet needed.");
    } catch {
      setNote(w);
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
        {duel && <button type="button" className="btn-ghost" onClick={copyWatch}>Copy watch link</button>}
      </div>
      {note && <p className="mt-2 break-all text-[12px] text-mute" role="status">{note}</p>}
      <div className="mt-4 flex items-center gap-4 border-t border-edge pt-4">
        <QrCode text={typeof window === "undefined" ? "" : window.location.href} size={132} />
        <div className="min-w-0 text-[13px] leading-snug text-text2">
          <p className="font-semibold text-white">Playing nearby? Scan this, or read out the code.</p>
          <p className="mt-2 font-display text-[26px] font-extrabold tracking-[0.12em] text-white">{toRoomCode(id)}</p>
          <p className="mt-1 text-mute">Your friend types it at Challenge a friend, under Join with a code.</p>
        </div>
      </div>
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
function RaceBars({ view, me, progress }: { view: View; me: string | null; progress: Progress | null }) {
  if (!progress || !view.players.every((p) => p.joined)) return null;
  const rows = view.players.map((p) => {
    const pct = progress[p.role] ?? 0;
    const mineRow = !!p.wallet && p.wallet === me;
    return { key: p.role, label: mineRow ? "You" : p.role === "creator" ? "Challenger" : "Friend", pct, mineRow };
  });
  return (
    <div className="race" aria-label="Race progress">
      {rows.map((r) => (
        <div key={r.key} className="race-row">
          <span className="race-name">{r.label}</span>
          <div className="race-track" role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.label} progress`}>
            <i data-me={r.mineRow} style={{ width: `${r.pct}%` }} />
          </div>
          <span className="race-pct">{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function ChallengeStatus({ view, me, failed, stake, progress, boards }: { view: View; me: string | null; failed: string | null; stake: Stake | null; progress: Progress | null; boards: ChallengeBoards | null }) {
  return (
    <section className="cotd-card mt-4" role="status" aria-live="polite">
      {view.duel && boards ? <DuelBoards view={view} boards={boards} me={me} progress={progress} /> : !view.settled && <RaceBars view={view} me={me} progress={progress} />}
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
      {stake.asset === "portal" ? (
        <p>Stake: <b className="text-white">one Portal each</b>{stake.locks.length ? ` (${stake.locks.map((l) => `#${l.portal}`).join(" and ")})` : ""}</p>
      ) : (
        <p>
          Stake: <b className="text-white">{stake.stakeTpot} tPOT</b> each · Pot: <b className="text-white">{stake.potTpot} tPOT</b>
        </p>
      )}
      {paid && stake.payoutTx && (
        <p className="mt-1">{stake.asset === "portal" ? "Both Portals went to" : "Paid to"} {short(stake.winner)}. <TxRef label="Payout transaction" tx={stake.payoutTx} block={stake.payoutBlock} /></p>
      )}
      {refunded && (
        <p className="mt-1">
          {stake.refundTxs.length ? (stake.asset === "portal" ? "Portals returned to the wallets they came from. " : "Stakes returned to the wallets they came from. ") : "Nothing was locked, so nothing moved. "}
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
    ? view.reason === "cancelled" ? "Challenge cancelled" : view.reason === "expired" ? "Challenge expired" : "Draw"
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
