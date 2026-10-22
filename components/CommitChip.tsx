"use client";
import Link from "next/link";
import { useState } from "react";

// Short form of the public fingerprint for today's board, with copy and a link to check it.
export default function CommitChip({ commit }: { commit: string }) {
  const [copied, setCopied] = useState(false);
  const short = commit.length > 16 ? `${commit.slice(0, 8)}…${commit.slice(-6)}` : commit;
  async function copy() {
    try { await navigator.clipboard.writeText(commit); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-edge bg-panel px-3 py-2 text-[12px] text-mute">
      <span>Board fingerprint</span>
      <code className="font-mono text-[13px] text-white">{short}</code>
      <button type="button" onClick={copy} className="rounded-md px-1.5 py-0.5 text-portal underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-mint">
        {copied ? "Copied" : "Copy"}
      </button>
      <Link href="/verify" className="ml-auto text-mint underline-offset-2 hover:underline">Check it was fair</Link>
    </div>
  );
}
