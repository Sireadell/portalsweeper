"use client";
import { useState } from "react";
import { cardPath, pagePath, shareText, type ShareParams } from "@/lib/share";

// Share the win: system share sheet with the card picture when the phone allows it,
// otherwise a PNG download. A second button copies a public link that previews in Discord and X.
export default function ShareButton({ name, params, cols, rows }: { name: string; params: ShareParams; cols: number; rows: number }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const text = shareText(name, params, cols, rows);
  const link = () => window.location.origin + pagePath(params);

  async function share() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(cardPath(params));
      if (!res.ok) throw new Error("card");
      const blob = await res.blob();
      const file = new File([blob], `portalsweeper-${params.token}-${params.date}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, url: link() });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNote("Card saved. Post it anywhere.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setNote("Could not make the card just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setNote("Link copied. It shows the card when pasted in Discord or X.");
    } catch {
      setNote(link());
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-main" onClick={share} disabled={busy}>
          {busy ? "Making card..." : "Share my win"}
        </button>
        <button type="button" className="btn-ghost" onClick={copy}>Copy link</button>
      </div>
      {note && <p className="mt-2 text-[12px] text-mute break-all" role="status">{note}</p>}
    </div>
  );
}
