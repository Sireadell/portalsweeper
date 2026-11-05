"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "./useWallet";
import { signText } from "./signing";
import { redeemMessage } from "@/lib/redeemMessage";
import { blockLink } from "@/lib/types";

type Award = {
  date: string;
  txHash?: string;
  block?: number;
  rows: { place: number; wallet: string; amount: number; portal?: number }[];
  held: { wallet: string; reason: string; detail: string }[];
  portalSkipped?: string;
};
type Info = {
  assetId: number;
  erc20: string;
  price: number;
  prizes: number[];
  supplyCap: number;
  supply: number | null;
  burned: number;
  balance: number | null;
  redeemsToday: number;
  redeemsPerDay: number;
  minted: number[] | null;
  awards: Award[];
  redeems: { portal: number; wallet: string; txHash: string; block: number }[];
};

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export default function RedeemPanel() {
  const { address, error: walletError, busy: connecting, connect } = useWallet();
  const [info, setInfo] = useState<Info | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pick, setPick] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; block?: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/shard${address ? `?address=${address}` : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error("load");
      setInfo(await r.json());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [address]);
  useEffect(() => {
    load();
  }, [load]);

  const taken = useMemo(() => new Set(info?.minted ?? []), [info]);
  const n = Number(pick);
  const valid = Number.isInteger(n) && n >= 1 && n <= 500;
  const isTaken = valid && taken.has(n);
  const have = info?.balance ?? 0;
  const price = info?.price ?? 100;
  const enough = have >= price;
  const full = !!info && info.redeemsToday >= info.redeemsPerDay;

  const freePick = () => {
    const free: number[] = [];
    for (let i = 1; i <= 500; i++) if (!taken.has(i)) free.push(i);
    if (free.length) setPick(String(free[Math.floor(Math.random() * free.length)]));
  };

  const redeem = async () => {
    if (!address || !valid || isTaken) return;
    setWorking(true);
    setMsg(null);
    try {
      const issuedAt = Date.now();
      const signature = await signText(redeemMessage(n, issuedAt), address);
      const r = await fetch("/api/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, signature, portal: n, issuedAt }) });
      const body = await r.json();
      if (!r.ok) setMsg({ ok: false, text: body.error ?? "Could not redeem." });
      else setMsg({ ok: true, text: `Portal #${body.portal} is now yours. ${price} SHARD were burned.`, block: body.block });
      await load();
    } catch (e) {
      const t = e instanceof Error ? e.message : "";
      setMsg({ ok: false, text: /reject|denied/i.test(t) ? "You closed the wallet request. Nothing was spent." : "Could not redeem. Nothing was spent." });
    } finally {
      setWorking(false);
    }
  };

  const status = !address
    ? "Connect your wallet first."
    : !valid && pick
      ? "Use a number from 1 to 500."
      : isTaken
        ? `Portal #${n} is already taken. Pick another.`
        : !enough
          ? info?.balance === null
            ? "Could not read your SHARD balance just now. Try again in a moment."
            : `You have ${have} SHARD. You need ${price}.`
          : full
            ? `The testnet limit of ${info?.redeemsPerDay} redeems a day is used up. Try after midnight UTC.`
            : valid
              ? `Portal #${n} is free.`
              : "";

  return (
    <div className="mt-6 grid gap-4">
      <section className="card p-4" aria-label="Your SHARD">
        <h2 className="text-[16px] font-bold text-white">Your SHARD</h2>
        {!address ? (
          <div className="mt-3">
            <button className="btn-main" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            {walletError && <p className="mt-2 text-[13px] text-text2">{walletError}</p>}
          </div>
        ) : (
          <>
            <p className="mt-2 text-[28px] font-extrabold tabular-nums text-white">
              {info?.balance ?? "…"} <span className="text-[14px] font-semibold text-mute">of {price} for a Portal</span>
            </p>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-ink2" role="progressbar" aria-valuemin={0} aria-valuemax={price} aria-valuenow={Math.min(have, price)}>
              <div className="h-full rounded-full bg-portal" style={{ width: `${Math.min(100, (have / price) * 100)}%` }} />
            </div>
            <p className="mt-2 break-all text-[12px] text-mute">
              Wallet {short(address)}. In your wallet SHARD is a normal token at {info?.erc20 ?? "…"} (no decimals).
            </p>
          </>
        )}
      </section>

      <section className="card p-4" aria-label="Redeem a Portal">
        <h2 className="text-[16px] font-bold text-white">Swap {price} SHARD for a Portal</h2>
        <p className="mt-1 text-[14px] text-text2">
          Pick a number from 1 to 500 that nobody owns yet. You sign one message in your wallet, which is free. We then take the {price} SHARD, burn them, and mint that Portal to your wallet in a single chain transaction.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="portal-pick">
            Portal number
          </label>
          <input
            id="portal-pick"
            inputMode="numeric"
            className="w-28 rounded-lg border border-edge bg-ink2 px-3 py-2 text-[16px] tabular-nums text-white"
            placeholder="1 to 500"
            value={pick}
            onChange={(e) => setPick(e.target.value.replace(/\D/g, "").slice(0, 3))}
          />
          <button className="btn-ghost" onClick={freePick} disabled={!info?.minted}>
            Pick a free one
          </button>
          <button className="btn-main" onClick={redeem} disabled={!address || !valid || isTaken || !enough || full || working}>
            {working ? "Working…" : `Redeem ${price} SHARD`}
          </button>
        </div>
        <p className="mt-2 text-[13px] text-text2" role="status">
          {status}
        </p>
        {msg && (
          <p className={`toast mt-2 ${msg.ok ? "" : "!border-red-400/50"}`} role="status">
            {msg.text}{" "}
            {msg.block ? (
              <a className="underline" href={blockLink(msg.block)} target="_blank" rel="noreferrer">
                See block {msg.block}
              </a>
            ) : null}
          </p>
        )}
        <p className="mt-2 text-[12px] text-mute">
          Testnet only. Each Portal takes about 11 test coins from the game wallet, so redeems are limited to {info?.redeemsPerDay ?? 3} a day.
        </p>
      </section>

      <section className="card p-4" aria-label="Daily awards">
        <h2 className="text-[16px] font-bold text-white">How SHARD is won</h2>
        <p className="mt-1 text-[14px] text-text2">
          Challenge of the Day only. Fastest clear {info?.prizes?.[0] ?? 10} SHARD, second {info?.prizes?.[1] ?? 4}, third {info?.prizes?.[2] ?? 2}. Friend races, practice and the daily Portal board pay nothing, because two wallets could farm them. You need a finished ranked try on an earlier day, and a clear faster than 0.3 seconds per safe tile is held back for a look.
        </p>
        {loadFailed && <p className="mt-2 text-[13px] text-text2">Could not load the latest awards just now.</p>}
        {info && info.awards.length === 0 && (
          <p className="mt-3 rounded-xl border border-dashed border-edge2 px-3 py-3 text-[14px] text-text2">No award has been paid yet. The first one is paid just after midnight UTC.</p>
        )}
        {info?.awards.map((a) => (
          <div key={a.date} className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-mute">
              <span>{a.date}</span>
              {a.block ? (
                <a className="underline" href={blockLink(a.block)} target="_blank" rel="noreferrer">
                  block {a.block}
                </a>
              ) : (
                <span>nothing paid</span>
              )}
            </div>
            <table className="w-full border-collapse text-[14px] tabular-nums">
              <tbody>
                {a.rows.map((r) => (
                  <tr key={r.place} className="border-t border-edge">
                    <td className="px-3 py-1.5 text-mute">#{r.place}</td>
                    <td className="px-3 py-1.5 text-white">{short(r.wallet)}</td>
                    <td className="px-3 py-1.5 text-right text-white">
                      {r.amount} SHARD{r.portal ? ` + Portal #${r.portal}` : ""}
                    </td>
                  </tr>
                ))}
                {a.held.map((h, i) => (
                  <tr key={`h${i}`} className="border-t border-edge text-mute">
                    <td className="px-3 py-1.5">held</td>
                    <td className="px-3 py-1.5">{short(h.wallet)}</td>
                    <td className="px-3 py-1.5 text-right">{h.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="card p-4" aria-label="Supply">
        <h2 className="text-[16px] font-bold text-white">Supply</h2>
        <p className="mt-1 text-[14px] text-text2">
          {info ? `${info.supply ?? "?"} SHARD exist now. ${info.burned} have been burned by redeems. ` : ""}
          Never more than {info?.supplyCap ?? 50000} will be made in total (500 Portals at {price} each). Redeemed SHARD are burned, so a Portal cannot be bought twice with the same coins.
        </p>
      </section>
    </div>
  );
}
