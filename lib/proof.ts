import { keccak256, toBytes } from "viem";
import { generateBoard } from "./engine";
import type { Board, PotMeta } from "./types";

export type CheckState = "pass" | "fail" | "wait";
export type ProofCheck = { label: string; state: CheckState; note: string };
export type ProofVerdict = "pass" | "fail" | "wait" | "partial";

export type ProofInput = {
  date: string;
  commit: string; // fingerprint our server shows for that day
  salt: string | null; // revealed secret, null while the day is live
  meta: PotMeta | null;
  chain: { found: boolean; data?: string; timestamp?: number; txHash?: string; block?: number; error?: string };
};

export const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const dayEnd = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000 + 86_400;

// The whole "recompute and compare" step, with no network and no React, so it can be tested.
export function checkProof(i: ProofInput): { verdict: ProofVerdict; headline: string; checks: ProofCheck[]; board?: Board } {
  const checks: ProofCheck[] = [];
  const chain = i.chain;

  if (!i.salt) {
    const ok = chain.found && same(chain.data, i.commit);
    checks.push({
      label: "Fingerprint posted on Portaldot",
      state: ok ? "pass" : chain.found ? "fail" : "wait",
      note: ok
        ? "Portaldot holds the same fingerprint our server shows now."
        : chain.found
          ? "The fingerprint on Portaldot is different from the one our server shows."
          : "No post found for this day yet.",
    });
    const bad = checks.some((c) => c.state === "fail");
    return {
      verdict: bad ? "fail" : "wait",
      headline: bad
        ? "The fingerprint on Portaldot does not match."
        : "This day is still live. Its secret is shown after the day ends, then you can recompute the board here.",
      checks,
    };
  }

  const recomputed = keccak256(toBytes(i.salt));
  const hashOk = same(recomputed, i.commit);
  checks.push({
    label: "Secret matches the fingerprint",
    state: hashOk ? "pass" : "fail",
    note: hashOk ? "Hashing the revealed secret gives the same fingerprint." : "Hashing the revealed secret gives a different fingerprint.",
  });

  let board: Board | undefined;
  if (i.meta) {
    board = generateBoard(i.meta, i.date, i.salt);
    checks.push({
      label: "Board rebuilt from the secret",
      state: same(board.commit, recomputed) ? "pass" : "fail",
      note: `Rebuilt this Pot's board in your browser: ${board.cols} by ${board.rows}, ${board.mines} mines.`,
    });
  } else {
    checks.push({ label: "Board rebuilt from the secret", state: "wait", note: "This Pot's art data was not available, so the layout could not be drawn." });
  }

  if (!chain.found) {
    checks.push({ label: "Fingerprint was posted on Portaldot before the day ended", state: "wait", note: chain.error ?? "No post found for this day." });
  } else {
    const dataOk = same(chain.data, recomputed);
    const timeOk = (chain.timestamp ?? Infinity) < dayEnd(i.date);
    checks.push({
      label: "Fingerprint was posted on Portaldot before the day ended",
      state: dataOk && timeOk ? "pass" : "fail",
      note: !dataOk
        ? "The fingerprint on Portaldot is different from this secret's fingerprint."
        : !timeOk
          ? "It was posted after the day was already over."
          : `Posted ${new Date((chain.timestamp as number) * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC.`,
    });
  }

  const failed = checks.some((c) => c.state === "fail");
  const waiting = checks.some((c) => c.state === "wait");
  return {
    verdict: failed ? "fail" : waiting ? "partial" : "pass",
    headline: failed
      ? "This board does NOT check out."
      : waiting
        ? "The maths checks out, but one proof is missing (see below)."
        : "This board is exactly the one that was promised that morning.",
    checks,
    board,
  };
}
