"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/practice", label: "Practice" },
  { href: "/play", label: "My Portals" },
  { href: "/cotd", label: "Portal of the day" },
  { href: "/wall", label: "Reveal wall" },
  { href: "/hall", label: "Hall" },
  { href: "/verify", label: "Verify" },
  // The optional Daily Portal shows in the menu only when it is switched on.
  ...(process.env.NEXT_PUBLIC_PORTAL_ENABLED === "true" ? [{ href: "/portal", label: "Daily Portal" }] : []),
];

// The logo is a tiny board: three covered tiles and one cleared tile showing a Portal.
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="relative grid shrink-0 grid-cols-2 gap-[2px] rounded-[9px] bg-ink2 p-[3px] ring-1 ring-edge2" style={{ width: size, height: size }} aria-hidden>
      <span className="rounded-[4px] bg-gradient-to-br from-[#6452c6] to-[#34286f]" />
      <span className="rounded-[4px] bg-gradient-to-br from-[#6452c6] to-[#34286f]" />
      <span className="rounded-[4px] bg-gradient-to-br from-[#6452c6] to-[#34286f]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/portals/7.webp" alt="" className="h-full w-full rounded-[4px] object-cover" />
    </span>
  );
}

export default function SiteHeader() {
  const path = usePathname() ?? "/";
  const isJudge = path.startsWith("/judge");
  return (
    <header className="sticky top-0 z-40 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Portalsweeper home">
          <Logo />
          <span className="font-display text-[18px] font-extrabold tracking-tight text-white">Portalsweeper</span>
        </Link>
        <nav aria-label="Main" className="site-nav ml-4 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}
              className="rounded-lg px-2.5 py-1.5 text-[14px] font-medium text-mute transition hover:text-white">
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/judge?id=7" aria-current={isJudge ? "page" : undefined}
          className={`ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold transition ${isJudge ? "border-mint bg-mint/10 text-mint" : "border-mint/50 text-mint hover:bg-mint/10"}`}>
          Judge mode <span className="hidden font-medium text-mint/80 sm:inline">· no wallet</span>
        </Link>
      </div>
      {/* phones and tablets: the same links in a row you can swipe */}
      <nav aria-label="Main" className="site-nav nav-scroll mx-auto flex w-full max-w-[1120px] gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-mute transition hover:text-white">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
