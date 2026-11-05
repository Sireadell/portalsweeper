import { chainFacts } from "@/lib/chainFacts";
import { PORTALDOT_CONSOLE, blockLink } from "@/lib/types";
import { confirmSteps, stakeSteps } from "@/lib/stakeProof";
import { STAKE_COPY } from "@/lib/stakeCopy";
import { PROOF, STAKE_CONTRACT } from "@/lib/chainProof";

export const dynamic = "force-dynamic";
export const metadata = { title: "On the chain", description: "What Portalsweeper does on Portaldot, read live from the chain, and which parts you have to trust." };

const TRUST: { part: string; trust: string; why: string }[] = [
  { part: "Fingerprint posted before play", trust: "Nobody", why: "It sits on the chain with a block time, so it cannot be changed after people start playing." },
  { part: "Secret checked against the fingerprint", trust: "Nobody", why: "Your browser does this on /verify today. Once the ledger contract is on the chain, it does the same check itself and refuses a wrong secret." },
  { part: "Chain random number", trust: "The 2 validators", why: "The testnet has only 2 block producers, so one could nudge the number. It still arrives after the fingerprint, so we cannot pick it." },
  { part: "The secret during the day", trust: "Our server", why: "The daily job and the server hold the secret while the day runs. The check proves the board was not changed, not that nobody saw it." },
  { part: "Who is recorded as winner", trust: "Our server wallet", why: "It writes the winner. The fingerprint of the winner's move log lets anyone check that claim." },
  { part: "Stakes on a challenge", trust: "Escrow contract, our referee", why: "A smart contract on the chain holds the stakes. Our server only names the winner, and the contract pays out or refunds. Tested on the chain with a real win and a real draw. Capped at 1 tPOT each." },
];

export default async function ChainPage() {
  const { facts, head } = await chainFacts();
  const steps = stakeSteps();
  const confirmed = await confirmSteps(steps);
  return (
    <main className="page-narrow">
      <p className="eyebrow mt-2">Portaldot V3 testnet</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">What Portalsweeper does on the chain</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text2">
        Each card below is read from Portaldot the moment you open this page{head ? `, at block ${head}` : ""}. A card marked Not yet is built but not running on the chain.
      </p>

      <div className="mt-6 grid gap-3">
        {facts.map((f) => (
          <section key={f.key} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[16px] font-bold text-white">{f.label}</h2>
              <span className={`chip shrink-0 ${f.state === "live" ? "!border-mint/50 !text-mint" : "!text-mute"}`}>{f.state === "live" ? "On" : "Not yet"}</span>
            </div>
            <p className="mt-2 text-[14px] text-text2">{f.value}</p>
            <p className="mt-1 text-[13px] text-mute">Check it: {f.how}</p>
          </section>
        ))}
      </div>

      <h2 className="mt-10 text-[22px] font-bold text-white">{STAKE_COPY.heading}</h2>
      <p className="mt-2 text-[14px] text-text2">{STAKE_COPY.intro}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
              <th className="px-3 py-2 font-semibold">Step</th>
              <th className="px-3 py-2 font-semibold">Match</th>
              <th className="px-3 py-2 font-semibold">Block</th>
              <th className="px-3 py-2 font-semibold">Receipt now</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={s.hash} className="border-t border-edge align-top">
                <td className="px-3 py-2.5 text-white">{STAKE_COPY.steps[s.kind]}</td>
                <td className="px-3 py-2.5 text-text2">{s.match === "setup" ? "Setup" : s.match === "win" ? "Win" : "Draw"}</td>
                <td className="px-3 py-2.5"><a className="underline" href={blockLink(s.block)} target="_blank" rel="noreferrer">{s.block}</a></td>
                <td className="px-3 py-2.5">{confirmed[i] ? "Success" : "Not read just now"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-mute">{STAKE_COPY.trustNote} {STAKE_COPY.checkNote}</p>

      <h2 className="mt-10 text-[22px] font-bold text-white">Proof you can check</h2>
      <p className="mt-2 text-[14px] text-text2">
        Real transactions from the Portaldot V3 testnet. Each link opens the block in the chain explorer. The stake contract lives at <span className="break-all font-mono text-[13px] text-white">{STAKE_CONTRACT}</span>. To open a staked match a wallet needs about 9 tPOT free, and 5 to join one, because the chain keeps a storage fee.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
              <th className="px-3 py-2 font-semibold">What happened</th>
              <th className="px-3 py-2 font-semibold">Block</th>
              <th className="px-3 py-2 font-semibold">{"Hash"}</th>
            </tr>
          </thead>
          <tbody>
            {PROOF.map((r) => (
              <tr key={r.hash} className="border-t border-edge align-top">
                <td className="px-3 py-2.5 text-white">{r.what}</td>
                <td className="px-3 py-2.5 text-text2">{r.block}</td>
                <td className="px-3 py-2.5">
                  <a className="break-all font-mono text-[12px] underline" href={blockLink(r.block ?? r.hash)} target="_blank" rel="noreferrer">{r.hash.slice(0, 10)}…{r.hash.slice(-6)}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-mute">Testnet only. tPOT has no value, and the stakes in these runs were test coins.</p>

      <h2 className="mt-10 text-[22px] font-bold text-white">Who you have to trust</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
              <th className="px-3 py-2 font-semibold">Part</th>
              <th className="px-3 py-2 font-semibold">You trust</th>
              <th className="px-3 py-2 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody>
            {TRUST.map((t) => (
              <tr key={t.part} className="border-t border-edge align-top">
                <td className="px-3 py-2.5 text-white">{t.part}</td>
                <td className="px-3 py-2.5">{t.trust}</td>
                <td className="px-3 py-2.5 text-text2">{t.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[13px] text-mute">
        This is the Portaldot V3 testnet. tPOT is a test coin with no value, so nothing real is at risk. <a className="underline" href={PORTALDOT_CONSOLE} target="_blank" rel="noreferrer">Open the chain explorer</a>.
      </p>
    </main>
  );
}
