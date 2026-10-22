import type { Metadata } from "next";
import Link from "next/link";
import { verifyPath } from "@/lib/proofBadge";
import { cardPath, formatTime, parseShareParams } from "@/lib/share";

type SP = Promise<{ token?: string; date?: string; time?: string }>;

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://portalsweeper.vercel.app";

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const p = parseShareParams(await searchParams);
  if (!p) return { title: "Portalsweeper" };
  const name = `Portal #${p.token}`;
  const title = `${name} cleared in ${formatTime(p.time)} on Portalsweeper`;
  const description = `Daily minesweeper board for ${p.date}. Every board can be checked against its fingerprint on Portaldot.`;
  const image = { url: ORIGIN + cardPath(p), width: 1080, height: 1350, alt: title };
  return {
    metadataBase: new URL(ORIGIN),
    title,
    description,
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function SharePage({ searchParams }: { searchParams: SP }) {
  const p = parseShareParams(await searchParams);
  if (!p) {
    return (
      <main className="page-narrow">
        <h1 className="text-2xl font-bold">That share link is not valid.</h1>
        <Link className="btn-main mt-5" href="/">Play Portalsweeper</Link>
      </main>
    );
  }
  return (
    <main className="page-narrow" style={{ maxWidth: 560 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cardPath(p)} alt={`Portal #${p.token} cleared in ${formatTime(p.time)} on ${p.date}`} style={{ width: "100%", height: "auto", borderRadius: 16 }} />
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className="btn-main" href="/">Play your Portal</Link>
        <Link className="btn-ghost" href={verifyPath(p.date, p.token)}>Verify this board</Link>
      </div>
    </main>
  );
}
