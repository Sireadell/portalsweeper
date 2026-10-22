import { shortFingerprint } from "./share";

// Wording and links for the "board was fixed before play" badge. Pure, so the win screen
// and the share card say exactly the same thing.
export type ProofBadgeInput = { date: string; token: number; commit: string; posted: boolean };

export type ProofBadge = {
  fingerprint: string;
  verifyPath: string;
  headline: string;
  detail: string;
};

export function verifyPath(date: string, token: number): string {
  return `/verify?date=${date}&token=${token}`;
}

export function proofBadge(p: ProofBadgeInput): ProofBadge {
  return {
    fingerprint: shortFingerprint(p.commit),
    verifyPath: verifyPath(p.date, p.token),
    headline: "Board fixed before play",
    detail: p.posted
      ? "This day's fingerprint was posted on Portaldot before the day ended, so the board could not be changed after you played."
      : "This day's fingerprint is set. It has not been posted on Portaldot yet, so for now only our server vouches for it.",
  };
}
