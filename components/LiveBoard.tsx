"use client";
import { useEffect, useRef, useState } from "react";

type SeatView = {
  state: "waiting" | "playing" | "won" | "lost";
  revealed: boolean[];
  flagged: boolean[];
  adj: (number | null)[];
  elapsed: number;
  opened: number;
  mines?: boolean[];
  hit?: number;
};
type Seat = { role: string; name: string | null; wallet: string; view: SeatView };
type Answer = {
  code: string;
  kind: "ranked" | "race";
  tags: string[];
  startedAt: number;
  endedAt: number | null;
  delayMs: number;
  serverNow: number;
  viewers: number;
  cols: number;
  rows: number;
  seats: Seat[];
  portal: { id: number; name: string; image: string };
};

const STATE_TEXT = { waiting: "Getting ready", playing: "Playing", won: "Cleared it", lost: "Hit a mine" } as const;
const NUM_COLOR = ["", "#6EC3F4", "#8BC9A3", "#F2A07B", "#B79CF0", "#F28B8B", "#6ED3D3", "#E8E0D0", "#A99F90"];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const who = (s: Seat) => s.name ?? s.wallet;

function Grid({ a, seat }: { a: Answer; seat: Seat }) {
  const v = seat.view;
  const done = !!v.mines;
  return (
    <div
      role="img"
      aria-label={`${v.opened} percent of the safe tiles are open`}
      className="mx-auto w-full max-w-[460px] overflow-hidden rounded-lg"
      style={{ display: "grid", gridTemplateColumns: `repeat(${a.cols}, minmax(0, 1fr))`, gap: 1, background: "#241E17" }}
    >
      {v.revealed.map((open, i) => {
        const mine = done && v.mines![i];
        const n = v.adj[i];
        const bg = mine ? (v.hit === i ? "#C4503F" : "#5A3A33") : open ? "#8BC9A3" : "#3A3228";
        return (
          <i
            key={i}
            style={{ background: bg, aspectRatio: "1 / 1", display: "grid", placeItems: "center", fontStyle: "normal", fontWeight: 800, fontSize: a.cols > 14 ? 9 : 12, lineHeight: 1, color: n ? "#1B1610" : "#F2C873" }}
          >
            {mine ? "✹" : open ? (n ? <span style={{ color: "#1B1610", textShadow: "none" }}>{n}</span> : "") : v.flagged[i] ? "⚑" : ""}
          </i>
        );
      })}
    </div>
  );
}

// A read only, 15 seconds late picture of a game. No sign-in. Used by /watch/CODE and by the event page.
export default function LiveBoard({ code }: { code: string }) {
  const [a, setA] = useState<Answer | null>(null);
  const [gone, setGone] = useState(false);
  const [viewers, setViewers] = useState<number | null>(null);
  const got = useRef(0);
  const [, tick] = useState(0);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch(`/api/live?id=${encodeURIComponent(code)}`, { cache: "no-store" });
        if (stop) return;
        if (r.status === 404) return setGone(true);
        if (!r.ok) return;
        const j = (await r.json()) as Answer;
        got.current = Date.now();
        setGone(false);
        setA(j);
      } catch { /* the next poll tries again */ }
    }
    void load();
    const poll = setInterval(load, 2000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { stop = true; clearInterval(poll); clearInterval(clock); };
  }, [code]);

  // A viewer tab says it is open: right away, then every 15 seconds.
  useEffect(() => {
    let stop = false;
    async function beat() {
      try {
        const r = await fetch("/api/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "heartbeat", id: code }) });
        if (!stop && r.ok) setViewers((await r.json()).viewers);
      } catch { /* ignore */ }
    }
    void beat();
    const t = setInterval(beat, 15000);
    return () => { stop = true; clearInterval(t); };
  }, [code]);

  if (gone && !a)
    return (
      <div className="card p-5 text-[15px] text-text2" role="status">
        This broadcast is over, or the link is wrong. <a className="text-mint underline-offset-2 hover:underline" href="/live">See what is live now</a>.
      </div>
    );
  if (!a) return <div className="card p-5 text-[14px] text-mute" role="status" aria-busy>Loading the broadcast…</div>;

  const since = Math.max(0, (Date.now() - got.current) / 1000);
  const allDone = a.seats.length > 0 && a.seats.every((s) => s.view.mines);
  const count = Math.max(viewers ?? 0, a.viewers);
  return (
    <section aria-label="Live game">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        {a.tags.map((t) => (
          <span key={t} className="rounded border border-edge px-2 py-0.5 text-text2">{t}</span>
        ))}
        <span className="ml-auto text-mute">{count} watching</span>
      </div>
      <div className={a.seats.length > 1 ? "grid gap-3 sm:grid-cols-2" : ""}>
        {a.seats.map((s) => {
          const shown = s.view.state === "playing" ? s.view.elapsed + since : s.view.elapsed;
          return (
            <div key={s.role} className="rounded-2xl border border-edge p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <b className="truncate text-[15px] text-white">{who(s)}</b>
                <span className="shrink-0 text-[13px] text-mute">{STATE_TEXT[s.view.state]} · {fmt(shown)} · {s.view.opened}%</span>
              </div>
              <Grid a={a} seat={s} />
            </div>
          );
        })}
        {a.seats.length === 0 && <div className="card p-5 text-[14px] text-mute">Waiting for the first player to sit down.</div>}
      </div>
      <p className="mt-3 text-[13px] text-mute">
        {allDone ? "The game is over. This is the final board." : `Shown ${Math.round(a.delayMs / 1000)} seconds late, so nobody can use it to help the player. Mines and hidden numbers stay off the screen until the game ends.`}
      </p>
    </section>
  );
}
