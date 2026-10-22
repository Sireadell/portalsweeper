import ProofSteps from "@/components/ProofSteps";

export const metadata = { title: "Check a board", description: "Rebuild any past Portalsweeper board in your browser and match it against the fingerprint posted on Portaldot." };

export default function VerifyPage() {
  return (
    <main className="page-narrow">
      <p className="eyebrow mt-2">Fairness check, no wallet</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Check the board in 60 seconds</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text2">
        Three steps, no wallet needed. Every morning we post a fingerprint of that day's secret on Portaldot. After the day ends the secret is shown, and your browser rebuilds the board to see if it matches.
      </p>
      <ProofSteps />
    </main>
  );
}
