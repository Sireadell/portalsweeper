import Link from "next/link";
import { moneyFacts } from "@/lib/moneyFacts";
import { MODEL_INPUTS, modelRows } from "@/lib/moneyModel";
import { portalSaleOn, saleFacts } from "@/lib/portalSale";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Money",
  description: "How Portalsweeper could earn, with real counts read from the chain and a clearly marked made-up example. Testnet coins have no value.",
};

const NOPE = "could not read just now";
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export default async function MoneyPage() {
  const f = await moneyFacts();
  const num = (n: number | null) => (n === null ? null : n.toLocaleString("en-US"));
  const real: { label: string; value: string | null; unit?: string; note?: string }[] = [
    { label: "Portals minted", value: f.portalsMinted === null ? null : `${f.portalsMinted} of ${f.portalSupply}`, note: "Counted from the Portal collection on Portaldot." },
    { label: "SHARD issued", value: num(f.shardIssued), unit: "SHARD", note: "Everything ever created: what exists now plus what was burned." },
    { label: "SHARD burned", value: num(f.shardBurned), unit: "SHARD", note: "Destroyed when someone swaps 100 SHARD for a Portal." },
    {
      label: "tPOT that went through backing pools",
      value: f.tpotThroughPools,
      unit: "tPOT",
      note: f.poolsPaid === null ? "Counted from finished pools in our records." : `Counted from our records: ${f.poolsPaid} pool${f.poolsPaid === 1 ? "" : "s"} paid winners, ${f.poolsRefunded} refunded.`,
    },
    {
      label: "Cut collected so far",
      value: f.tpotCutCollected,
      unit: "tPOT",
      note: f.cutPercentNow > 0 ? `The cut is ${f.cutPercentNow}% on pools opened now.` : "The cut is switched off, so this stays at zero until I turn it on.",
    },
    {
      label: "Treasury wallet balance",
      value: f.treasuryBalanceTpot,
      unit: "tPOT",
      note: f.treasury
        ? `${f.treasuryIsPoolWallet ? "The treasury is the same wallet that holds pool coins, so this includes coins held for pools that are still open. " : ""}Wallet ${short(f.treasury)}, read from the chain.`
        : "No treasury wallet is set up here yet.",
    },
  ];
  const rows = modelRows();
  const sale = portalSaleOn() ? await saleFacts() : null;
  return (
    <main className="page-narrow">
      <p className="eyebrow mt-2">Portaldot V3 testnet</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">How Portalsweeper could earn</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text2">
        I get asked how this makes money, so here it is in one page. First the numbers that are real today, read straight from the chain and our records. Then a made-up example of how three money lines would work. Everything here runs on testnet coins with no value, so nothing on this page is income.
      </p>

      <h2 className="mt-8 text-[22px] font-bold text-white">Real counts</h2>
      <p className="mt-1 text-[13px] text-mute">Read when you opened this page. If a read fails it says so instead of showing a number.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {real.map((r) => (
          <section key={r.label} className="card p-4">
            <p className="text-[12px] font-bold uppercase tracking-wider text-mint">Real count</p>
            <h3 className="mt-1 text-[15px] font-bold text-white">{r.label}</h3>
            {r.value === null ? (
              <p className="mt-2 text-[16px] text-text2">{NOPE}</p>
            ) : (
              <p className="mt-2 break-words text-[26px] font-extrabold text-white">
                {r.value}
                {r.unit ? <span className="ml-1.5 text-[14px] font-semibold text-text2">{r.unit}</span> : null}
              </p>
            )}
            {r.note && <p className="mt-1 text-[13px] text-mute">{r.note}</p>}
          </section>
        ))}
      </div>

      <h2 className="mt-10 text-[22px] font-bold text-white">The three money lines</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-text2">
        Players never pay just to play. People pay for something they want to own, brands pay for attention, and I keep a small cut when friends back a player.
      </p>
      <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-text2">
        <li><b className="text-white">Portal sales.</b> There are 500 Portals and I will never make more. The sale route works on the chain today. A price on mainnet is not set.</li>
        <li><b className="text-white">Pool cut.</b> When a pool pays out, {f.cutPercentNow > 0 ? `${f.cutPercentNow}%` : "a small share"} of the pot goes to the treasury wallet, in the same chain action as the winners. The note on the chain lists the pot, the cut and every backer's share. Refunds take nothing.</li>
        <li><b className="text-white">Sponsored days.</b> A brand would pay a day's prize plus a fee and get its name on the board. Planned, not built.</li>
      </ul>

      {portalSaleOn() && (
        <section className="card mt-8 p-4" aria-labelledby="sale-title">
          <p className="text-[12px] font-bold uppercase tracking-wider text-mint">Real, on the testnet</p>
          <h2 id="sale-title" className="mt-1 text-[20px] font-bold text-white">Buy a Portal</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-text2">
            A Portal can be bought straight from the chain with its built-in shop, from a normal 0x wallet, in one action. The price is what 100 SHARD cost at the SHARD pool price right now, rounded up to the next 0.01 tPOT. These are testnet coins with no value.
          </p>
          {sale === null ? (
            <p className="mt-2 text-[15px] text-text2">{NOPE}</p>
          ) : (
            <>
              <p className="mt-2 text-[26px] font-extrabold text-white">{sale.priceTpot.toFixed(2)}<span className="ml-1.5 text-[14px] font-semibold text-text2">tPOT each</span></p>
              <p className="mt-1 text-[13px] text-mute">
                {sale.forSale.length > 0 ? `For sale now: Portal ${sale.forSale.map((n) => "#" + n).join(", ")}.` : "Nothing is for sale right now."}
                {sale.sold.length > 0 ? ` Already bought: ${sale.sold.map((n) => "#" + n).join(", ")}.` : ""}
              </p>
            </>
          )}
          <p className="mt-2 text-[13px] text-mute">The first real purchase is in the proof list on the <Link href="/chain" className="text-mint underline-offset-2 hover:underline">chain page</Link>.</p>
        </section>
      )}

      <section className="card mt-8 border-dashed p-4" aria-labelledby="model-title">
        <p className="text-[12px] font-bold uppercase tracking-wider text-gold">Modelled example, made up</p>
        <h2 id="model-title" className="mt-1 text-[20px] font-bold text-white">What the shape looks like with invented numbers</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-text2">
          Every number in this box is made up to show how each line works. Testnet coins have no value, nobody has paid me anything, and this is not a forecast. Change the inputs in your head and the results move with them.
        </p>
        <div className="mt-3 grid gap-3">
          {rows.map((r) => (
            <div key={r.line} className="rounded-xl border border-edge bg-ink2 p-3">
              <p className="text-[15px] font-bold text-white">{r.line}</p>
              <p className="mt-1 text-[13px] text-mute">Formula: {r.formula}</p>
              <p className="text-[13px] text-mute">Made-up inputs: {r.inputs}</p>
              <p className="mt-1 text-[14px] text-text2">Example result: <b className="text-white">{r.result}</b></p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-mute">
          {MODEL_INPUTS.portalsSold} is the real Portal supply. The price, the weekly amounts, the sponsor and the fee are all invented.
        </p>
      </section>

      <h2 className="mt-10 text-[22px] font-bold text-white">The honest part</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-text2">
        Putting real money on a game with any luck in it is regulated in many places, and Minesweeper sometimes forces a guess. So today everything is testnet coins. Before any real money touches it I would start with free-entry sponsored days, take legal advice country by country, and only allow real stakes where it is clearly legal. I only pay the top 3 of a one-try ranked day, so there is nothing to farm just for turning up.
      </p>
      <p className="mt-4 text-[14px]">
        <Link href="/chain" className="text-mint underline-offset-2 hover:underline">See what runs on the chain</Link>
        {" · "}
        <Link href="/shard" className="text-mint underline-offset-2 hover:underline">SHARD</Link>
      </p>
    </main>
  );
}
