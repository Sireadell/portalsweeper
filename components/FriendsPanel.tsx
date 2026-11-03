"use client";
import Link from "next/link";
import { useState } from "react";
import { useWallet } from "./useWallet";
import { useFriends } from "./useFriends";
import { toRoomCode } from "@/lib/roomCode";

// Username, friends, requests and challenge invites. Needs a wallet only to prove who you are (free, no transaction).
export default function FriendsPanel() {
  const { address, error: walletError, busy: walletBusy, connect, disconnect } = useWallet();
  const { me, error, busy, call } = useFriends(address);
  const [name, setName] = useState("");
  const [find, setFind] = useState("");
  const [note, setNote] = useState("");

  if (!address)
    return (
      <div className="card p-5 text-center sm:p-6">
        <p className="text-[15px] text-text2">Connect your wallet to pick a username and add friends. Signing is free and sends no transaction.</p>
        <button className="btn-main btn-lg mt-4" onClick={connect} disabled={walletBusy}>{walletBusy ? "Waiting for your wallet…" : "Connect wallet"}</button>
        {walletError && <p className="mt-3 text-[14px] text-boom" role="alert">{walletError}</p>}
      </div>
    );

  if (!me) return <p className="text-[14px] text-mute" role="status">{error || "Signing you in…"}</p>;

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (await call("claim", { name })) setName("");
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call("request", { name: find });
    if (ok) { setNote(`Request sent to ${find.replace(/^@/, "").toLowerCase()}. They see it next time they open Friends.`); setFind(""); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-text2">
          {me.username ? <>You are <b className="text-white">@{me.username}</b></> : "Pick a username so friends can find you."}
        </p>
        <button onClick={disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
      </div>
      {error && <p className="text-[14px] text-boom" role="alert">{error}</p>}

      {!me.username ? (
        <form onSubmit={claim} className="card p-5">
          <h2 className="text-[16px] font-bold text-white">Choose your username</h2>
          <p className="mt-1 text-[13px] text-text2">3 to 16 letters, numbers or underscores. You pick it once and it cannot be changed.</p>
          <div className="mt-3 flex gap-2">
            <input className="field font-bold" value={name} onChange={(e) => setName(e.target.value)} placeholder="sireadell" aria-label="Username" autoCapitalize="none" autoComplete="off" maxLength={17} />
            <button type="submit" className="btn-main !px-6" disabled={busy}>Save</button>
          </div>
        </form>
      ) : (
        <>
          <section className="card p-5" aria-label="Invites">
            <h2 className="text-[16px] font-bold text-white">Invites for you</h2>
            {me.invites.length === 0 ? (
              <p className="mt-2 text-[14px] text-mute">None right now. When a friend challenges you, it shows up here.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {me.invites.map((i) => (
                  <li key={i.challengeId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-panel2 px-3 py-2.5">
                    <span className="text-[14px] text-white"><b>@{i.fromName}</b> challenged you <span className="text-mute">· {toRoomCode(i.challengeId)}</span></span>
                    <span className="flex gap-2">
                      <Link href={`/challenge/${i.challengeId}`} className="btn-main !px-4 !py-2 text-[14px]">Play</Link>
                      <button className="btn-ghost" onClick={() => call("dismiss", { challengeId: i.challengeId })}>Dismiss</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {me.requests.length > 0 && (
            <section className="card p-5" aria-label="Friend requests">
              <h2 className="text-[16px] font-bold text-white">Friend requests</h2>
              <ul className="mt-3 space-y-2">
                {me.requests.map((p) => (
                  <li key={p.wallet} className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-panel2 px-3 py-2.5">
                    <b className="text-[14px] text-white">@{p.name}</b>
                    <span className="flex gap-2">
                      <button className="btn-main !px-4 !py-2 text-[14px]" onClick={() => call("accept", { name: p.name })}>Accept</button>
                      <button className="btn-ghost" onClick={() => call("decline", { name: p.name })}>Decline</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-5" aria-label="Friends">
            <h2 className="text-[16px] font-bold text-white">Your friends</h2>
            {me.friends.length === 0 ? (
              <p className="mt-2 text-[14px] text-mute">No friends yet. Add someone by their username below.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {me.friends.map((p) => (
                  <li key={p.wallet} className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-panel2 px-3 py-2.5">
                    <b className="text-[14px] text-white">@{p.name}</b>
                    <span className="flex gap-2">
                      <Link href={`/challenge?with=${encodeURIComponent(p.name)}`} className="btn-main !px-4 !py-2 text-[14px]">Challenge</Link>
                      <button className="btn-ghost" onClick={() => call("remove", { name: p.name })} aria-label={`Remove ${p.name}`}>Remove</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={ask} className="mt-4 flex gap-2">
              <input className="field font-bold" value={find} onChange={(e) => { setFind(e.target.value); setNote(""); }} placeholder="Friend's username" aria-label="Friend's username" autoCapitalize="none" autoComplete="off" />
              <button type="submit" className="btn-ghost !px-5" disabled={busy || !find.trim()}>Add friend</button>
            </form>
            {note && <p className="mt-2 text-[13px] text-text2" role="status">{note}</p>}
          </section>
        </>
      )}
    </div>
  );
}
