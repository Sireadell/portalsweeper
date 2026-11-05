import RedeemPanel from "@/components/RedeemPanel";

export const metadata = { title: "SHARD", description: "Win SHARD in the Challenge of the Day. 100 SHARD buys one Portal NFT on the Portaldot testnet." };

export default function ShardPage() {
  return (
    <main className="page-narrow">
      <p className="eyebrow mt-2">Portaldot V3 testnet</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">SHARD</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text2">
        SHARD is the prize for the Challenge of the Day. The three fastest clears each day win some. Save up 100 and you can swap them for any Portal that is still free.
        It is a testnet token with no money value.
      </p>
      <RedeemPanel />
    </main>
  );
}
