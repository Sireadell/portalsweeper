"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PORTAL_SUPPLY } from "@/lib/types";

// "Type any Portal number" box on the home page. It opens that Portal in Judge mode, no wallet.
export default function QuickPlay() {
  const router = useRouter();
  const [v, setV] = useState("7");
  const [err, setErr] = useState("");
  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > PORTAL_SUPPLY) { setErr(`Type a number from 1 to ${PORTAL_SUPPLY}.`); return; }
    router.push(`/judge?id=${n}`);
  }
  function random() {
    router.push(`/judge?id=${1 + Math.floor(Math.random() * PORTAL_SUPPLY)}`);
  }
  return (
    <form onSubmit={go} className="w-full">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-semibold text-mute">Portal number, 1 to {PORTAL_SUPPLY.toLocaleString("en-US")}</span>
        <div className="flex gap-2">
          <input inputMode="numeric" aria-label="Portal number" value={v}
            onChange={(e) => { setErr(""); setV(e.target.value.replace(/\D/g, "").slice(0, 4)); }}
            className="field min-w-0 flex-1 font-display text-lg font-bold" placeholder="7" />
          <button type="submit" className="btn-main shrink-0 !px-5">Play</button>
          <button type="button" onClick={random} className="btn-ghost h-11 shrink-0" aria-label="Play a random Portal">🎲</button>
        </div>
      </label>
      {err && <p className="mt-2 text-[13px] text-boom" role="alert">{err}</p>}
    </form>
  );
}
