"use client";
import { useState } from "react";
import { createPublicClient, createWalletClient, custom, http, parseEther, type EIP1193Provider, type Hex } from "viem";
import { portaldot } from "@/lib/portaldot";
import { blockLink } from "@/lib/types";
import { eventOpenMessage } from "@/lib/predictMessage";
import { signText } from "./signing";
import { useWallet } from "./useWallet";

export type EventSide = { side: "creator" | "opponent"; wallet: string | null; name: string | null; totalTpot: string; backers: number; payoutPerTpot: number | null };
export type EventBack = { wallet: string; name: string | null; side: "creator" | "opponent"; amountTpot: string; txHash: string; refundOnly: string | null };
export type EventData = {
  id: string; status: "open" | "locked" | "settled" | "refunded"; label: string; potTpot: string; capTpot: string; minTpot: string; maxBackers: number;
  houseCutPercent: { now: number; planned: number }; cut: { percent: number; treasury: string | null; paidTpot: string | null; paidTo: string | null }; closed: boolean; sides: EventSide[]; backs: EventBack[];
  winner: string | null; winnerSide: "creator" | "opponent" | null; reason: string | null;
  payoutTx: string | null; payoutBlock: number | null; payoutMode: "batch" | "single" | null; payoutTxs: string[]; note: string | null;
  expiresAt: number; escrow: string | null;
};
export type NoEvent = { creator: string; canOpen: boolean };

const CHOICES = ["0.05", "0.1", "0.25", "0.5"];
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const sideName = (s: EventSide, fallback: string) => s.name ?? (s.wallet ? short(s.wallet) : fallback);

// Everything a person does on the event page: the race creator opens backing, a backer picks a side and sends tPOT.
export default function BackPanel({ id, event, race, escrow, onChange }: { id: string; event: EventData | null; race: NoEvent | null; escrow: string | null; onChange: () => void }) {
  const { address, connect, busy: connecting, error: walletError } = useWallet();
  const [amount, setAmount] = useState("0.1");
  const [side, setSide] = useState<"creator" | "opponent">("creator");
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const me = address?.toLowerCase() ?? null;

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    return { ok: r.ok, j };
  }

  async function open() {
    if (!address) return;
    setWorking(true);
    setMsg(null);
    try {
      const signature = await signText(eventOpenMessage(id), address);
      const { ok, j } = await post({ action: "open", id, address, signature });
      if (!ok) throw new Error(j.error ?? "Could not open backing.");
      onChange();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not open backing.");
    } finally {
      setWorking(false);
    }
  }

  async function back() {
    if (!address || !event) return;
    const escrowAddr = event.escrow ?? escrow;
    if (!escrowAddr) return setMsg("The pool wallet is not available right now.");
    setWorking(true);
    setMsg(null);
    try {
      const eth = window.ethereum as EIP1193Provider | undefined;
      if (!eth) throw new Error("No wallet found in this browser.");
      const client = createWalletClient({ account: address as Hex, chain: portaldot, transport: custom(eth) });
      const pub = createPublicClient({ chain: portaldot, transport: http() });
      const value = parseEther(amount);
      const have = await pub.getBalance({ address: address as Hex });
      if (have < value) throw new Error("Your wallet does not hold that much tPOT.");
      setMsg("Confirm the transfer in your wallet…");
      const txHash = await client.sendTransaction({ to: escrowAddr as Hex, value });
      setMsg("Sent. Waiting for the chain to confirm…");
      await pub.waitForTransactionReceipt({ hash: txHash });
      let last = "Could not record your backing.";
      for (let i = 0; i < 8; i++) {
        const { ok, j } = await post({ action: "back", id, wallet: address, side, txHash });
        if (ok) {
          setMsg("You are in. Your backing is recorded.");
          onChange();
          return;
        }
        last = j.error ?? last;
        if (!/not found yet/i.test(last)) break;
        await new Promise((res) => setTimeout(res, 3000));
      }
      throw new Error(`${last} Your transfer ${txHash} was sent. Do not send it again; ask the site owner to check it.`);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setMsg(/reject|denied/i.test(m) ? "You closed the wallet request. Nothing was sent." : m || "Could not back this player.");
    } finally {
      setWorking(false);
    }
  }

  const connectRow = !address && (
    <div>
      <button className="btn-main" onClick={connect} disabled={connecting}>{connecting ? "Connecting…" : "Connect wallet"}</button>
      {walletError && <p className="mt-2 text-[13px] text-text2" role="alert">{walletError}</p>}
    </div>
  );
  const note = msg && <p className="mt-3 text-[14px] text-text2" role="status">{msg}</p>;

  // No event yet: only the race creator can start one, and only before the first move.
  if (!event) {
    const isCreator = !!me && !!race && me === race.creator;
    return (
      <div className="card p-5">
        <h2 className="text-[19px] font-bold text-white">Backing is not open for this race</h2>
        {race?.canOpen ? (
          <>
            <p className="mt-1 text-[14px] text-text2">The person who made the race can open backing before anyone makes a move. Friends then put testnet tPOT on who they think wins.</p>
            <div className="mt-3">{connectRow}{address && isCreator && <button className="btn-main" onClick={open} disabled={working}>{working ? "Opening…" : "Open backing (free signature)"}</button>}</div>
            {address && !isCreator && <p className="mt-2 text-[13px] text-mute">Only the race creator can open it.</p>}
          </>
        ) : (
          <p className="mt-1 text-[14px] text-text2">This race has already started or finished, so backing cannot open.</p>
        )}
        {note}
      </div>
    );
  }

  const [c, o] = event.sides;
  const competitor = !!me && (me === c.wallet || me === o.wallet);
  const mine = event.backs.find((b) => b.wallet === me);
  return (
    <div className="card p-5">
      <h2 className="text-[19px] font-bold text-white">Back a player</h2>
      <p className="mt-1 text-[13px] text-mute">{event.label}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {event.sides.map((s, i) => {
          const picked = side === s.side;
          const winner = event.winnerSide === s.side;
          return (
            <button
              key={s.side}
              type="button"
              disabled={event.closed}
              onClick={() => setSide(s.side)}
              aria-pressed={picked}
              className={`rounded-xl border p-4 text-left ${picked && !event.closed ? "border-mint" : "border-edge"} bg-ink2`}
            >
              <b className="block text-[16px] text-white">{sideName(s, i === 0 ? "Challenger" : "Friend (not here yet)")}{winner ? " · won" : ""}</b>
              <span className="mt-1 block text-[13px] text-text2">{s.totalTpot} tPOT from {s.backers} {s.backers === 1 ? "backer" : "backers"}</span>
              <span className="block text-[13px] text-mute">{s.payoutPerTpot ? `1 tPOT on them pays about ${s.payoutPerTpot.toFixed(2)} now` : "No one yet"}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[14px] text-text2">
        Pot: <b className="text-white">{event.potTpot} tPOT</b>. Backers of the winner share the whole pot in proportion to what they put in. Each backer can put {event.minTpot} to {event.capTpot} tPOT, up to {event.maxBackers} backers. House cut: {event.houseCutPercent.now}% now ({event.houseCutPercent.planned}% planned).
      </p>

      {event.status === "open" && (
        <div className="mt-4">
          {connectRow}
          {address && competitor && <p className="text-[14px] text-text2">You are one of the two players, so you cannot back.</p>}
          {address && !competitor && mine && <p className="text-[14px] text-text2">You backed {mine.amountTpot} tPOT. Backing closes at the first move.</p>}
          {address && !competitor && !mine && (
            <>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Amount in tPOT">
                {CHOICES.map((c2) => (
                  <button key={c2} type="button" className={`chip ${amount === c2 ? "!border-mint" : ""}`} aria-pressed={amount === c2} onClick={() => setAmount(c2)}>{c2} tPOT</button>
                ))}
              </div>
              <button className="btn-main mt-3" onClick={back} disabled={working}>{working ? "Working…" : `Back ${sideName(side === "creator" ? c : o, "this player")} with ${amount} tPOT`}</button>
            </>
          )}
        </div>
      )}
      {event.status === "locked" && <p className="mt-4 text-[14px] text-text2">The race has started, so backing is closed. Payout comes when it finishes.</p>}
      {(event.status === "settled" || event.status === "refunded") && (
        <div className="mt-4 text-[14px] text-text2">
          <p><b className="text-white">{event.status === "settled" ? "Paid out." : "Refunded."}</b> {event.reason}</p>
          {event.payoutTx && (
            <p className="mt-1 break-all">
              {event.payoutMode === "single" ? "First payout" : "One batch"} transaction: <span className="font-mono text-[13px] text-white">{event.payoutTx}</span>
              {event.payoutBlock ? <> in <a className="text-mint underline-offset-2 hover:underline" href={blockLink(event.payoutBlock)} target="_blank" rel="noreferrer">block {event.payoutBlock}</a></> : null}
            </p>
          )}
          {event.cut.paidTpot && <p className="mt-1">The treasury cut was <b className="text-white">{event.cut.paidTpot} tPOT</b> ({event.cut.percent}% of the pot), paid in the same action as the backers.</p>}
          {event.note && <p className="mt-1 break-all text-[13px] text-mute">Note on the chain: {event.note}</p>}
        </div>
      )}

      {event.backs.length > 0 && (
        <ul className="mt-4 divide-y divide-edge text-[14px]">
          {event.backs.map((b) => (
            <li key={b.txHash} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="text-white">{b.name ?? short(b.wallet)} <span className="text-mute">backs {sideName(b.side === "creator" ? c : o, b.side)}</span></span>
              <span className="text-text2">{b.amountTpot} tPOT{b.refundOnly ? " (sent back)" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {note}
    </div>
  );
}
