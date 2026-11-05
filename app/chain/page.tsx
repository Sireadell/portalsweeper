import { chainFacts } from "@/lib/chainFacts";
import { PORTALDOT_CONSOLE, blockLink } from "@/lib/types";
import { confirmSteps, stakeSteps } from "@/lib/stakeProof";
import { STAKE_COPY } from "@/lib/stakeCopy";
import { PROOF, STAKE_CONTRACT, type ProofRow } from "@/lib/chainProof";

export const dynamic = "force-dynamic";
export const metadata = { title: "On the chain", description: "What Portalsweeper does on Portaldot, read live from the chain." };

// The five strongest proofs stay on show; the rest fold away.
const TOP_HASHES = [
  "0xebf6729cfea048e05fd6f8a467c44a309d72aa84bd052efdf9237a93ebbef94f", // one action: mint, traits, SHARD, note
  "0xf3460a822018aa88a1d5a746b4e5e81a3b6f777c0207d26766d966198b4ecbc7", // redeem 100 SHARD for a Portal
  "0xdb68140095b7bae93e7894e6f00426a91fff0685a5129f41decb04b939a5eec1", // stake won, contract paid
  "0xed5b9b7700fa50a6b803b00286888e39578cec7272b84b01fa2df378b802c34b", // Portal stake payout
  "0x66e0f1b146f6c280a470c64166887a4dbdcec95870e97883f58a5792b57ab4aa", // backing pool payout
];

function ProofTable({ rows }: { rows: ProofRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
            <th className="px-3 py-2 font-semibold">What happened</th>
            <th className="px-3 py-2 font-semibold">Block</th>
            <th className="px-3 py-2 font-semibold">Hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
  );
}

export default async function ChainPage() {
  const { facts, head } = await chainFacts();
  const top = PROOF.filter((r) => TOP_HASHES.includes(r.hash));
  const rest = PROOF.filter((r) => !TOP_HASHES.includes(r.hash));
  const steps = stakeSteps();
  const confirmed = await confirmSteps(steps);
  return (
    <main className="page">
      <p className="eyebrow mt-2">Portaldot V3 testnet</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">What Portalsweeper does on the chain</h1>
      <p className="mt-3 max-w-[820px] text-[15px] leading-relaxed text-text2">
        Each card below is read from Portaldot the moment you open this page{head ? `, at block ${head}` : ""}. A card marked Not yet is built but not running on the chain.
      </p>
      <p className="mt-2 max-w-[820px] text-[14px] leading-relaxed text-text2">
        A Portaldot account can pay its chain fee in SHARD. The chain swaps a little SHARD for tPOT through the SHARD pool, and the account never needs tPOT. The last transaction in the table below shows it.
      </p>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {facts.map((f) => (
          <section key={f.key} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[16px] font-bold text-white">{f.label}</h2>
              {f.state !== "live" && <span className="chip shrink-0 !text-mute">Not yet</span>}
            </div>
            <p className="mt-2 text-[14px] text-text2">{f.value}</p>
            <p className="mt-1 text-[13px] text-mute">Check it: {f.how}</p>
          </section>
        ))}
      </div>

      <details className="group mt-10">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <h2 className="text-[22px] font-bold text-white">{STAKE_COPY.heading}</h2>
          <span className="text-[13px] text-mute group-open:hidden">Show</span>
          <span className="hidden text-[13px] text-mute group-open:inline">Hide</span>
        </summary>
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
      </details>

      <h2 className="mt-10 text-[22px] font-bold text-white">Proof you can check</h2>
      <p className="mt-2 max-w-[820px] text-[14px] text-text2">
        Real transactions from the Portaldot V3 testnet. Each link opens the block in the chain explorer. The stake contract lives at <span className="break-all font-mono text-[13px] text-white">{STAKE_CONTRACT}</span>. To open a staked match a wallet needs about 9 tPOT free, and 5 to join one, because the chain keeps a storage fee.
      </p>
      <ProofTable rows={top} />
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-white underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show all {PROOF.length} transactions</span>
          <span className="hidden group-open:inline">Hide the other {rest.length}</span>
        </summary>
        <ProofTable rows={rest} />
      </details>
      <p className="mt-3 text-[13px] text-mute">Testnet only. tPOT has no value, and the stakes in these runs were test coins.</p>

      <p className="mt-10 text-[13px] text-mute">
        This is the Portaldot V3 testnet. tPOT is a test coin with no value, so nothing real is at risk. <a className="underline" href={PORTALDOT_CONSOLE} target="_blank" rel="noreferrer">Open the chain explorer</a>.
      </p>
    </main>
  );
}
