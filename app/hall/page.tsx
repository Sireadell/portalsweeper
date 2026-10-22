import Link from "next/link";
import { getStore, rankCotd, type PotRecord } from "@/lib/records";
import { utcToday } from "@/lib/salt";
import { shortWallet } from "@/lib/cotd";
import { POT_SUPPLY } from "@/lib/types";
import CotdCard from "@/components/CotdCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hall of Pots", description: "Fastest clears of the Pot of the day, most boards cleared and longest daily streaks." };

const time = (s: number | null) => (s === null ? "-" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

type Col = { head: string; right?: boolean };

function Board({ title, note, empty, cols, rows }: { title: string; note?: string; empty: string; cols: Col[]; rows: { key: string; cells: React.ReactNode[] }[] }) {
  return (
    <section className="card flex flex-col p-4 sm:p-5">
      <h2 className="text-[19px] font-bold text-white">{title}</h2>
      {note && <p className="mt-1 text-[13px] text-mute">{note}</p>}
      {rows.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-edge2 px-4 py-6 text-center">
          <span className="grid grid-cols-3 gap-1" aria-hidden>
            {[0, 1, 2].map((k) => <span key={k} className="h-5 w-5 rounded-[5px] bg-gradient-to-br from-[#6452c6] to-[#34286f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]" />)}
          </span>
          <p className="max-w-[34ch] text-[14px] text-text2">{empty}</p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
          <table className="w-full border-collapse text-[14px] tabular-nums">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
                <th className="px-3 py-2 font-semibold">#</th>
                {cols.map((c) => (
                  <th key={c.head} className={`px-3 py-2 font-semibold ${c.right ? "text-right" : ""}`}>{c.head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="border-t border-edge">
                  <td className={`px-3 py-2.5 ${i === 0 ? "font-black text-mint" : "text-mute"}`}>{i + 1}</td>
                  {r.cells.map((c, j) => (
                    <td key={j} className={`px-3 py-2.5 ${cols[j]?.right ? "text-right" : ""}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const potCell = (id: number) => (
  <span className="inline-flex items-center gap-2 font-semibold text-white">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/pots/${id}.webp`} alt="" width={24} height={24} loading="lazy" className="h-6 w-6 rounded-md object-cover" />
    #{id}
  </span>
);

export default async function HallPage() {
  const store = getStore();
  const today = utcToday();
  const [records, entries] = await Promise.all([store.listRecords(), store.cotdEntries(today)]);
  const won = records.filter((r: PotRecord) => r.wins > 0);
  const top = rankCotd(entries).slice(0, 10);
  const cleared = [...won].sort((a, b) => b.wins - a.wins || (a.bestSeconds ?? 1e9) - (b.bestSeconds ?? 1e9)).slice(0, 10);
  const streaks = [...won].sort((a, b) => b.longestStreak - a.longestStreak || b.wins - a.wins).slice(0, 10);

  return (
    <main className="page">
      <header className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <p className="eyebrow">Records</p>
          <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Hall of Pots</h1>
        </div>
        <Link href="/wall" className="btn-ghost">Reveal wall: {won.length} of {POT_SUPPLY.toLocaleString()} →</Link>
      </header>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-text2">Records belong to the Pot, not the wallet. If a Pot is sold, its history goes to the new owner with it.</p>

      <div className="mt-6"><CotdCard hideActions /></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">

      <Board
        title="Today's top 10, fastest clear"
        note={`Pot of the day, ${today} UTC. One ranked try per wallet, only clears count.`}
        empty="No clears yet today. The first wallet to clear the Pot of the day takes the top spot."
        cols={[{ head: "Wallet" }, { head: "Time", right: true }, { head: "Moves", right: true }]}
        rows={top.map((e) => ({ key: e.wallet, cells: [<span key="w" className="font-mono text-white">{shortWallet(e.wallet)}</span>, time(e.seconds ?? null), String(e.moves ?? "-")] }))}
      />

      <Board
        title="Most boards cleared"
        note="Pots ranked by daily boards won, ties go to the faster best time."
        empty="Nothing cleared yet. The first Pot to win a board takes the top spot."
        cols={[{ head: "Pot" }, { head: "Cleared", right: true }, { head: "Fastest", right: true }]}
        rows={cleared.map((r) => ({ key: String(r.tokenId), cells: [potCell(r.tokenId), String(r.wins), time(r.bestSeconds)] }))}
      />

      <Board
        title="Longest streaks"
        empty="No streaks yet. Clear a board on two days in a row to start one."
        cols={[{ head: "Pot" }, { head: "Best", right: true }, { head: "Now", right: true }]}
        rows={streaks.map((r) => ({ key: String(r.tokenId), cells: [potCell(r.tokenId), `${r.longestStreak} d`, `${r.currentStreak} d`] }))}
      />
      </div>
    </main>
  );
}
