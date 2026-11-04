import { chainFacts } from "@/lib/chainFacts";
import { PORTALDOT_CONSOLE } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "On the chain", description: "What Portalsweeper does on Portaldot, read live from the chain, and what is and is not trustless." };

const TRUST: { part: string; trust: string; why: string }[] = [
  { part: "Fingerprint posted before play", trust: "Trustless", why: "It sits on the chain with a block time. Nobody can change it afterwards." },
  { part: "Secret revealed and checked", trust: "Trustless", why: "The ledger contract hashes the secret itself and refuses a wrong one. Your browser can do the same maths." },
  { part: "Chain random number", trust: "Not fully", why: "The testnet has only 2 validators, so one of them could nudge it. It still comes after the fingerprint." },
  { part: "Who gets recorded as winner", trust: "Trusted", why: "The game's server wallet writes the winner. The move log fingerprint lets anyone check the claim." },
  { part: "Stakes", trust: "Trusted", why: "A server wallet holds the stakes and pays out. Test coins only, with a low cap. A contract version comes later." },
];

export default async function ChainPage() {
  const { facts, head } = await chainFacts();
  return (
    <main className="page-narrow">
      <p className="eyebrow mt-2">Portaldot V3 testnet</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">What Portalsweeper does on the chain</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text2">
        Everything below is read from Portaldot when you open this page{head ? ` (latest block ${head})` : ""}. Where something is not switched on yet, it says so.
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

      <h2 className="mt-10 text-[22px] font-bold text-white">What you have to trust, and what you do not</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-ink2">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
              <th className="px-3 py-2 font-semibold">Part</th>
              <th className="px-3 py-2 font-semibold">Trust</th>
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
        All of this runs on a test network, and the coins have no value. <a className="underline" href={PORTALDOT_CONSOLE} target="_blank" rel="noreferrer">Open the chain explorer</a>.
      </p>
    </main>
  );
}
