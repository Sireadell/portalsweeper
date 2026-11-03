"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@/components/useWallet";
import { signText } from "@/components/signing";
import { todayUTC } from "@/components/dailySalt";
import { StakeSelector } from "@/components/StakePanel";
import { challengeCreateMessage } from "@/lib/challenge-message";
import { fromRoomCode } from "@/lib/roomCode";
import { useFriends } from "@/components/useFriends";
import MyChallenges from "@/components/MyChallenges";
import { rememberChallenge } from "@/lib/myChallenges";

export default function NewChallengePage() {
  const { address, error, busy, connect, disconnect } = useWallet();
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const [msg, setMsg] = useState("");
  const [stake, setStake] = useState("0");
  const { call: friendCall } = useFriends(address, false);
  const [code, setCode] = useState("");
  const [friend, setFriend] = useState("");
  useEffect(() => { setFriend((new URLSearchParams(window.location.search).get("with") ?? "").toLowerCase()); }, []);
  const [codeErr, setCodeErr] = useState("");
  function join(e: React.FormEvent) {
    e.preventDefault();
    const id = fromRoomCode(code);
    if (!id) { setCodeErr("That code should be 12 letters and numbers, like A1B2-C3D4-E5F6."); return; }
    router.push(`/challenge/${id}`);
  }

  async function make() {
    if (!address) return;
    setMsg("");
    setMaking(true);
    let sig: string;
    try {
      sig = await signText(challengeCreateMessage(todayUTC()), address);
    } catch {
      setMsg("No signature was given, so no challenge was made. Press the button to try again.");
      setMaking(false);
      return;
    }
    try {
      const r = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", address, signature: sig, ...(stake !== "0" ? { stakeTpot: stake } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not make the challenge.");
      rememberChallenge(j.challenge.id, address, "creator");
      if (friend) await friendCall("invite", { name: friend, challengeId: j.challenge.id }); // tells them in their inbox
      router.push(`/challenge/${j.challenge.id}`);
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "Could not reach the server. Check your connection and try again.");
      setMaking(false);
    }
  }

  return (
    <main className="page">
      {address && (
        <header className="mb-5 flex items-center justify-end gap-3">
          <button onClick={disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
        </header>
      )}
      <section className="mx-auto max-w-[720px] pt-2">
        <p className="eyebrow">Player against player</p>
        <h1 className="mb-5 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Challenge a friend</h1>
        <div className="card p-5 sm:p-6">
          <ol className="space-y-2 text-[15px] text-text2">
            <li><b className="text-white">1.</b> Make a challenge and send your friend the link.</li>
            <li><b className="text-white">2.</b> You both play the same hidden board. One try each, timed by the server.</li>
            <li><b className="text-white">3.</b> The faster clear wins. Hitting a mine loses.</li>
          </ol>
          <div className="mt-5 border-t border-edge pt-5 text-center">
            {!address ? (
              <>
                <p className="text-[14px] text-mute">Connect a wallet so the challenge knows who is who. Signing is free and sends no transaction.</p>
                <button className="btn-main btn-lg mt-4" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
                {error && <p className="mt-3 text-[14px] text-boom" role="alert">{error}</p>}
              </>
            ) : (
              <>
                <StakeSelector value={stake} onChange={setStake} />
                {stake !== "0" && <p className="mb-3 text-[13px] text-mute">Each player puts up {stake} tPOT before playing. The winner takes both. Testnet tPOT, no value.</p>}
                <button className="btn-main btn-lg" onClick={make} disabled={making}>{making ? "Check your wallet…" : friend ? `Challenge @${friend}` : "Make a challenge link"}</button>
                {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
              </>
            )}
          </div>
        </div>
        {address && <MyChallenges address={address} />}
        <form onSubmit={join} className="card mt-4 p-5 sm:p-6">
          <h2 className="text-[16px] font-bold text-white">Join with a code</h2>
          <p className="mt-1 text-[13px] text-text2">Playing next to a friend? Type the code from their screen, or scan their QR code with your phone camera.</p>
          <div className="mt-3 flex gap-2">
            <input className="field font-display font-bold uppercase tracking-[0.1em]" value={code} onChange={(e) => { setCode(e.target.value); setCodeErr(""); }} placeholder="A1B2-C3D4-E5F6" aria-label="Room code" autoCapitalize="characters" autoComplete="off" />
            <button type="submit" className="btn-main !px-6">Join</button>
          </div>
          {codeErr && <p className="mt-2 text-[13px] text-boom" role="alert">{codeErr}</p>}
        </form>
        <p className="mt-4 text-center text-[13px] text-mute">
          Want to play alone? Try the <Link href="/cotd" className="text-mint underline-offset-2 hover:underline">Portal of the day</Link>.
        </p>
      </section>
    </main>
  );
}
