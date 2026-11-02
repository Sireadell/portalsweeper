"use client";
import { HARD_DAYS, SET_SIZE, WEEKDAYS, shardCount, setComplete, type ShardState } from "@/lib/shards";

// One shard for each weekday you clear a ranked board. Seven make a set.
export default function ShardBar({ shards, note }: { shards: ShardState; note?: string | null }) {
  const n = shardCount(shards);
  return (
    <section className="space-y-2" aria-label="Your shards">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-mute">Shards {n}/{SET_SIZE}</h3>
      <div className="shard-bar">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className="shard" data-got={!!shards.got[i]} data-hard={HARD_DAYS.includes(i)} title={HARD_DAYS.includes(i) ? `${d}: needs a hard clear` : d}>
            <b aria-hidden>{shards.got[i] ? "◆" : "◇"}</b>
            <span>{d.slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-snug text-mute">
        Clear a ranked board each weekday. Saturday and Sunday only drop from a hard clear: a Rare or bigger Portal, a twist, or a friend win. Missed a day? Make it up next week.
        {setComplete(shards) ? " Set complete." : ""} Shards are kept in this browser for now.
      </p>
      {note && <p className="toast" role="status">{note}</p>}
    </section>
  );
}
