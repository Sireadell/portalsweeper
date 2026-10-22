"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { proofBadge } from "@/lib/proofBadge";

// Small badge for the win screen: the board was fixed before play, with a link to check it.
// It asks the verify route whether Portaldot has the day's post, and only then says "posted".
export default function ProofBadge({ date, token, commit }: { date: string; token: number; commit: string }) {
  const [posted, setPosted] = useState(false);
  useEffect(() => {
    let live = true;
    setPosted(false);
    fetch(`/api/verify?date=${date}&token=${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.chain?.found && j.commit === commit) setPosted(true); })
      .catch(() => { /* badge still shows, just without the posted claim */ });
    return () => { live = false; };
  }, [date, token, commit]);

  const b = proofBadge({ date, token, commit, posted });
  return (
    <div className="mt-3 rounded-xl border border-mint/40 bg-mint/5 px-3 py-2.5 text-[12px] leading-snug text-[#cfc9ea]" data-testid="proof-badge">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-mint">✓ {b.headline}</span>
        <code className="font-mono text-[12px] text-white">{b.fingerprint}</code>
      </div>
      <p className="mt-1 text-mute">{b.detail}</p>
      <Link href={b.verifyPath} className="mt-1 inline-block text-mint underline-offset-2 hover:underline">Check it yourself</Link>
    </div>
  );
}
