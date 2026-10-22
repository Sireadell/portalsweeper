import RevealWall from "@/components/RevealWall";

export const metadata = { title: "Reveal wall", description: "All 500 Pots. Each one lights up when someone clears its daily board." };

export default function WallPage() {
  return (
    <main className="page">
      <div className="pt-2"><RevealWall /></div>
    </main>
  );
}
