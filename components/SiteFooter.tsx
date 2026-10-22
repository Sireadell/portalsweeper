import Link from "next/link";
import { Logo } from "./SiteHeader";

export default function SiteFooter() {
  return (
    <footer className="border-t border-edge/70">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-8 text-[13px] text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo size={24} />
          <span>Portalsweeper. A daily minesweeper for the 500 Portals on Portaldot.</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/judge?id=7" className="hover:text-white">Judge mode</Link>
          <Link href="/practice" className="hover:text-white">Practice</Link>
          <Link href="/cotd" className="hover:text-white">Portal of the day</Link>
          <Link href="/wall" className="hover:text-white">Reveal wall</Link>
          <Link href="/hall" className="hover:text-white">Hall</Link>
          <Link href="/verify" className="hover:text-white">Check a board was fair</Link>
        </nav>
      </div>
    </footer>
  );
}
