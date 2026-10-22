"use client";
import { useEffect, useState } from "react";
import { checkProof, type ProofCheck, type ProofInput, type ProofVerdict } from "@/lib/proof";
import { shortFingerprint } from "@/lib/share";
import type { Board, PotMeta } from "@/lib/types";
import { PORTALDOT_RPC, blockLink } from "@/lib/types";

type Api = ProofInput & { tokenId: number; revealed: boolean };
type Result = { verdict: ProofVerdict; headline: string; checks: ProofCheck[]; board?: Board; api: Api };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => iso(Date.now());
const yesterday = () => iso(Date.now() - 86_400_000);

// Ask Portaldot directly from this browser, so the answer does not rely on our server.
async function readChain(hash: string, fallback: Api["chain"]): Promise<Api["chain"]> {
  try {
    const call = async (method: string, params: unknown[]) =>
      (await (await fetch(PORTALDOT_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
    const tx = await call("eth_getTransactionByHash", [hash]);
    const block = await call("eth_getBlockByNumber", [tx.blockNumber, false]);
    return { found: true, data: tx.input, timestamp: Number(BigInt(block.timestamp)), txHash: hash, block: Number(BigInt(tx.blockNumber)) };
  } catch {
    return fallback;
  }
}

async function getApi(token: string, date: string): Promise<Api> {
  const res = await fetch(`/api/verify?token=${encodeURIComponent(token)}&date=${encodeURIComponent(date)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
  return body as Api & { meta: PotMeta | null };
}

const COLORS = { pass: "var(--mint)", fail: "var(--boom)", wait: "#f5c96b", partial: "#f5c96b" } as const;
const MARK = { pass: "✓", fail: "✗", wait: "…" } as const;
const mono = { fontFamily: "ui-monospace, monospace", wordBreak: "break-all" } as const;

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-bold text-white">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-pot text-sm font-extrabold shadow-[0_3px_0_#4b33c4]">{n}</span>
      {title}
    </h2>
  );
}

export default function ProofSteps() {
  const [now, setNow] = useState<Api | null>(null);
  const [nowErr, setNowErr] = useState("");
  const [token, setToken] = useState("1");
  const [date, setDate] = useState(yesterday());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<Result | null>(null);

  useEffect(() => {
    getApi("1", today())
      .then(async (a) => setNow({ ...a, chain: a.chain.txHash ? await readChain(a.chain.txHash, a.chain) : a.chain }))
      .catch((e) => setNowErr(e instanceof Error ? e.message : "Could not load today's fingerprint."));
  }, []);

  async function go() {
    setBusy(true);
    setErr("");
    setOut(null);
    try {
      const api = await getApi(token.trim(), date);
      const chain = api.chain.txHash ? await readChain(api.chain.txHash, api.chain) : api.chain;
      const full = { ...api, chain };
      setOut({ ...checkProof(full), api: full });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const field = { background: "var(--panel)", border: "1px solid var(--edge)", borderRadius: 8, padding: "10px 12px", color: "inherit", font: "inherit" } as const;
  const card = "card p-4 sm:p-5";
  const nowOk = now && now.chain.found && now.chain.data?.toLowerCase() === now.commit.toLowerCase();

  return (
    <div className="mt-6 space-y-4">
      <section className={card}>
        <StepHead n={1} title="See today's fingerprint" />
        <p className="mt-2 text-[14px] leading-relaxed text-[#cfc9ea]">Posted on Portaldot each morning. It locks in today's secret before anyone plays.</p>
        {nowErr && <p className="mt-3 text-boom">{nowErr}</p>}
        {!now && !nowErr && <p className="mt-3 text-mute">Loading...</p>}
        {now && (
          <div className="mt-3 space-y-2 text-[13px]">
            <p className="text-mute">Day {now.date} (UTC)</p>
            <p style={mono}>{now.commit}</p>
            {now.chain.txHash ? (
              <p>
                <span style={{ color: nowOk ? "var(--mint)" : "var(--boom)" }}>{nowOk ? "✓ Same fingerprint is on Portaldot. " : "✗ Portaldot shows a different value. "}</span>
                {now.chain.block ? (
                  <a className="underline" href={blockLink(now.chain.block)} target="_blank" rel="noreferrer">Open block {now.chain.block} ({shortFingerprint(now.chain.txHash)})</a>
                ) : (
                  <span style={mono}>{shortFingerprint(now.chain.txHash)}</span>
                )}
              </p>
            ) : (
              <p style={{ color: "#f5c96b" }}>Not posted on Portaldot yet for today. The fingerprint above is what our server shows now. Step 2 works on any finished day.</p>
            )}
          </div>
        )}
      </section>

      <section className={card}>
        <StepHead n={2} title="Pick a past day and a Pot" />
        <p className="mt-2 text-[14px] leading-relaxed text-[#cfc9ea]">Your browser takes that day's revealed secret and builds the board again from scratch.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[13px]">
            Pot number
            <input style={{ ...field, width: 110 }} inputMode="numeric" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <label className="grid gap-1 text-[13px]">
            Day (UTC)
            <input style={field} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" onClick={go} disabled={busy} className="btn-main !py-2.5">
            {busy ? "Checking..." : "Check this board"}
          </button>
        </div>
        {err && <p className="mt-3 text-boom">{err}</p>}
      </section>

      <section className={card} style={out ? { borderColor: COLORS[out.verdict] } : undefined} aria-live="polite">
        <StepHead n={3} title="Match or mismatch" />
        {!out && <p className="mt-2 text-[14px] text-mute">The result shows here after step 2.</p>}
        {out && (
          <>
            <div className="mt-3 flex items-center gap-3">
              <span style={{ fontSize: 36, lineHeight: 1, color: COLORS[out.verdict] }} aria-hidden>
                {out.verdict === "pass" ? "✓" : out.verdict === "fail" ? "✗" : "…"}
              </span>
              <p className="text-base font-semibold text-white">{out.headline}</p>
            </div>
            <ul className="mt-3 grid gap-2 text-[14px]">
              {out.checks.map((c) => (
                <li key={c.label} className="flex gap-2">
                  <span style={{ color: COLORS[c.state], width: 16 }}>{MARK[c.state]}</span>
                  <span><strong>{c.label}.</strong> <span className="text-[#cfc9ea]">{c.note}</span></span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 grid gap-1 text-[12px] text-mute">
              <div><dt className="inline">Fingerprint: </dt><dd className="inline" style={mono}>{out.api.commit}</dd></div>
              {out.api.salt && <div><dt className="inline">Secret: </dt><dd className="inline" style={mono}>{out.api.salt}</dd></div>}
              {out.api.chain.txHash && (
                <div><dt className="inline">Portaldot post: </dt><dd className="inline" style={mono}>{out.api.chain.block ? <a className="underline" href={blockLink(out.api.chain.block)} target="_blank" rel="noreferrer">{shortFingerprint(out.api.chain.txHash)} (block {out.api.chain.block})</a> : shortFingerprint(out.api.chain.txHash)}</dd></div>
              )}
            </dl>
            {out.board && (
              <div className="mt-4">
                <p className="mb-2 text-[12px] text-mute">Mine layout for Pot #{out.api.tokenId} on {out.api.date} (● is a mine, numbers count mines next to a square):</p>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${out.board.cols}, minmax(0, 26px))`, gap: 2 }}>
                  {out.board.cells.map((c, i) => (
                    <div key={i} style={{ aspectRatio: "1", display: "grid", placeItems: "center", fontSize: 11, borderRadius: 4, background: c.mine ? "var(--boom)" : "var(--ink)", border: "1px solid var(--edge)", color: c.mine ? "#fff" : "#b9b2e0" }}>
                      {c.mine ? "●" : c.adj > 0 ? c.adj : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-edge p-4" style={{ background: "rgba(131,110,249,0.08)" }}>
        <h2 className="text-base font-bold text-white">What this proves and what it does not</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#cfc9ea]"><strong className="text-mint">It proves:</strong> the day's secret was locked on Portaldot before the day ended, and every board that day was built from that same secret. Nobody, including us, can quietly change a board afterwards.</p>
        <p className="mt-2 text-[14px] leading-relaxed text-[#cfc9ea]"><strong className="text-[#f5c96b]">It does not prove:</strong> that the secret stayed hidden during the day. Our server holds it while the day is live, so the fingerprint only stops after-the-fact changes. It does not stop us from peeking in the moment.</p>
      </section>
    </div>
  );
}
