"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./useWallet";
import { todayUTC } from "./dailySalt";

const MAIN = [
  { href: "/practice", label: "Play", icon: "M8 5v14l11-7z" },
  { href: "/challenge", label: "Challenge", icon: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { href: "/friends", label: "Friends", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zm-11 9c0-3.3 3.1-6 7-6s7 2.7 7 6z" },
  { href: "/wall", label: "Wall", icon: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z" },
];
const MORE_GROUPS = [
  {
    heading: "Play",
    items: [
      { href: "/play", label: "My Portals", hint: "Your Portals. Pick one to play" },
      { href: "/cotd", label: "Today's Portal", hint: "Today's board. Fastest three win SHARD" },
      { href: "/live", label: "Watch live", hint: "Watch games being played right now" },
      { href: "/hall", label: "Past winners", hint: "Who won each past daily board" },
      // The optional Daily Portal shows in the menu only when it is switched on.
      ...(process.env.NEXT_PUBLIC_PORTAL_ENABLED === "true" ? [{ href: "/portal", label: "Daily Portal", hint: "The Daily Portal board" }] : []),
    ],
  },
  { heading: "SHARD", items: [{ href: "/shard", label: "SHARD points", hint: "Earn it by winning, spend it on Portals" }] },
  {
    heading: "Fair and open",
    items: [
      { href: "/verify", label: "Check a board", hint: "Confirm a past board wasn't changed" },
      { href: "/chain", label: "Proof on Portaldot", hint: "Every game action, with checkable links" },
      { href: "/money", label: "How we earn", hint: "We keep 5% of prize pools" },
    ],
  },
];
const MORE = MORE_GROUPS.flatMap((g) => g.items);

// The logo is a tiny board: three covered tiles and one cleared tile showing a Portal.
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="relative grid shrink-0 grid-cols-2 gap-[2px] rounded-[9px] bg-ink2 p-[3px] ring-1 ring-edge2" style={{ width: size, height: size }} aria-hidden>
      <span className="rounded-[4px] bg-gradient-to-br from-[#3A322C] to-[#221D19]" />
      <span className="rounded-[4px] bg-gradient-to-br from-[#3A322C] to-[#221D19]" />
      <span className="rounded-[4px] bg-gradient-to-br from-[#3A322C] to-[#221D19]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/portals/7.webp" alt="" className="h-full w-full rounded-[4px] object-cover" />
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden><path d={d} /></svg>;
}

// "More" holds the pages most people open less often. It closes when you pick one, tap outside or press Escape.
function MoreMenu({ path, up = false }: { path: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const inMore = MORE.some((m) => path.startsWith(m.href));
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className={up ? "tab-item" : "nav-link"} data-active={inMore ? "true" : undefined}>
        {up ? <Icon d="M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /> : null}
        <span>More</span>
        {!up && <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="m7 10 5 5 5-5z" /></svg>}
      </button>
      {open && (
        <div role="menu" className={`menu-pop ${up ? "menu-pop-up" : ""}`}>
          {MORE_GROUPS.map((g) => (
            <div key={g.heading} role="group" aria-label={g.heading}>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-mute">{g.heading}</p>
              {g.items.map((m) => (
                <Link key={m.href} href={m.href} role="menuitem" title={m.hint} aria-current={path.startsWith(m.href) ? "page" : undefined}>{m.label}</Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// How many friend requests and challenge invites are waiting. It only looks if you already signed in on the
// Friends page today (that signature is kept for the tab), so it never opens a wallet prompt by itself.
function useInboxCount(): number {
  const { address } = useWallet();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!address) { setN(0); return; }
    let live = true;
    const check = async () => {
      let sig: string | null = null;
      try { sig = sessionStorage.getItem(`portalsweeper:friends-sign:${address.toLowerCase()}:${todayUTC()}`); } catch { /* blocked */ }
      if (!sig) return;
      try {
        const r = await fetch("/api/friends", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "me", address, signature: sig }) });
        if (!r.ok) return;
        const me = (await r.json()).me;
        if (live) setN((me?.invites?.length ?? 0) + (me?.requests?.length ?? 0));
      } catch { /* the next check tries again */ }
    };
    void check();
    const t = setInterval(check, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [address]);
  return n;
}

const Badge = ({ n }: { n: number }) => (n > 0 ? <span className="nav-badge" aria-label={`${n} waiting`}>{n > 9 ? "9+" : n}</span> : null);

export default function SiteHeader() {
  const path = usePathname() ?? "/";
  const inbox = useInboxCount();
  const isJudge = path.startsWith("/judge");
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-edge/70 bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Portalsweeper home">
            <Logo />
            <span className="font-display text-[18px] font-extrabold tracking-tight text-white">Portalsweeper</span>
          </Link>
          <nav aria-label="Main" className="site-nav ml-6 hidden items-center gap-1 lg:flex">
            {MAIN.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined} className="nav-link">{n.label}{n.href === "/friends" && <Badge n={inbox} />}</Link>
            ))}
            <MoreMenu path={path} />
          </nav>
          <Link href="/judge?id=7" aria-current={isJudge ? "page" : undefined}
            className={`ml-auto inline-flex min-h-[36px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-bold transition ${isJudge ? "border-mint bg-mint/15 text-mint" : "border-mint/50 text-mint hover:bg-mint/10"}`}>
            Judge mode
          </Link>
        </div>
      </header>
      {/* phones and tablets: a tab bar under your thumb */}
      <nav aria-label="Main" className="tab-bar lg:hidden">
        {MAIN.map((n) => (
          <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined} className="tab-item">
            <Icon d={n.icon} /><span>{n.label}</span>{n.href === "/friends" && <Badge n={inbox} />}
          </Link>
        ))}
        <MoreMenu path={path} up />
      </nav>
    </>
  );
}
