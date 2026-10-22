"use client";
import { useEffect, useState } from "react";

// The Portal's own artwork. Shows the small local copy at once (fast on a phone), swaps to the
// full picture when it has loaded, and falls back to a gradient with the token number.
export default function PortalArt({ src, tokenId, className = "" }: { src: string; tokenId: number; className?: string }) {
  const local = `/portals/${tokenId}.webp`;
  const [shown, setShown] = useState<string>(local);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setShown(local);
    setFailed(false);
    if (!src) return;
    const img = new Image();
    img.onload = () => setShown(src);
    img.src = src;
  }, [local, src]);

  if (failed) {
    return (
      <div className={`grid place-items-center bg-[radial-gradient(circle_at_30%_20%,#a78bfa,#4c1d95_55%,#1e1038)] ${className}`} aria-hidden>
        <span className="text-[22cqw] font-black text-white/25 tabular-nums">{tokenId}</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={shown}
      alt=""
      className={`object-cover ${className}`}
      onError={() => {
        if (shown === local && src) setShown(src);
        else setFailed(true);
      }}
      draggable={false}
      referrerPolicy="no-referrer"
    />
  );
}
