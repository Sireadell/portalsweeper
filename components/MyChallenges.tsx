"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { forgetChallenge, myChallenges } from "@/lib/myChallenges";
import type { ChallengeView } from "@/lib/challenge";
import { portalLabel } from "@/lib/names";

type Row = { id: string; view: ChallengeView | null; gone: boolean };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function describe(v: ChallengeView, me: string): string {
  if (v.reason === "cancelled") return "Cancelled";
  if (v.status === "expired") return "Expired, nobody joined";
  if (v.status === "open") return `Waiting for a friend. Link open until ${clock(v.expiresAt)}`;
  if (v.status === "playing") return "In progress";
  if (!v.winner) return "Draw";
  return v.winner === me ? "You won" : "You lost";
}

// Every challenge this browser made or joined with the connected wallet, newest first.
export default function MyChallenges({ address }: { address: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    const ids = myChallenges(address).slice(0, 12);
    Promise.all(ids.map(async ({ id }): Promise<Row> => {
      try {
        const r = await fetch(`/api/challenge?id=${id}`, { cache: "no-store" });
        if (r.status === 404) { forgetChallenge(id, address); return { id, view: null, gone: true }; }
        if (!r.ok) return { id, view: null, gone: false };
        return { id, view: (await r.json()).challenge as ChallengeView, gone: false };
      } catch {
        return { id, view: null, gone: false };
      }
    })).then((out) => { if (live) setRows(out.filter((x) => !x.gone)); });
    return () => { live = false; };
  }, [address]);

  if (!rows || rows.length === 0) return null;
  const me = address.toLowerCase();
  return (
    <section className="card mt-4 p-5 sm:p-6" aria-label="Your challenges">
      <h2 className="text-[16px] font-bold text-white">Your challenges</h2>
      <ul className="mt-3 divide-y divide-edge">
        {rows.map(({ id, view }) => (
          <li key={id}>
            <Link href={`/challenge/${id}`} className="flex items-center justify-between gap-3 py-2.5 text-[14px] hover:text-white">
              <span className="min-w-0">
                <b className="block truncate text-white">{view ? portalLabel(view.tokenId) : "Challenge"}</b>
                <span className="text-text2">{view ? describe(view, me) : "Could not load"}</span>
              </span>
              <span className="shrink-0 text-mint">Open</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
