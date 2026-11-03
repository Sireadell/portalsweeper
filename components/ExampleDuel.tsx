import { MiniBoard } from "./DuelBoards";
import type { SeatBoard } from "@/lib/challenge";

// A fixed picture of what a live duel looks like, so a visitor can see it without connecting a wallet.
// It is labelled Example and is never real data.
function sample(cols: number, rows: number, open: number[], flag: number[] = []): SeatBoard {
  const n = cols * rows;
  return { cols, rows, revealed: Array.from({ length: n }, (_, i) => open.includes(i)), flagged: Array.from({ length: n }, (_, i) => flag.includes(i)), state: "playing" };
}
const LEFT = sample(9, 9, [0, 1, 2, 9, 10, 11, 12, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 36, 37, 38, 39, 40, 41, 45, 46, 47, 48, 54, 55, 56], [14]);
const RIGHT = sample(9, 9, [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 18, 19, 20, 21, 22, 23, 27, 28, 29, 30, 31, 32, 36, 37, 38, 39, 40, 41, 42, 45, 46, 47, 48, 49, 50, 54, 55, 56, 57, 58, 63, 64, 65], [8, 35]);

export default function ExampleDuel({ note }: { note?: string }) {
  return (
    <section className="card mt-4 p-5 sm:p-6" aria-label="Example of a live duel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold text-white">What a live duel looks like</h2>
        <span className="chip !border-portal/50 !text-[#F2C873]">Example</span>
      </div>
      <p className="mt-1 text-[13px] text-text2">{note ?? "You both get the same hidden board, start together after a 3, 2, 1 countdown and watch each other open tiles. First to clear wins."}</p>
      <div className="duel-grid">
        <div className="duel-side" data-me="true">
          <div className="mb-2 flex justify-between text-[13px]"><b className="text-white">You</b><span className="text-mute">Playing · 41%</span></div>
          <MiniBoard b={LEFT} />
        </div>
        <div className="duel-side">
          <div className="mb-2 flex justify-between text-[13px]"><b className="text-white">Friend</b><span className="text-mute">Playing · 63%</span></div>
          <MiniBoard b={RIGHT} />
        </div>
      </div>
    </section>
  );
}
