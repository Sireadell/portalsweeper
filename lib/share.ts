import { PORTAL_SUPPLY } from "./types";

// Pure helpers for the share card. No wallet data ever goes in these URLs.
export type ShareParams = { token: number; date: string; time: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SHARE_SECONDS = 3 * 60 * 60;

export function validDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

function qs(p: ShareParams): string {
  return `token=${p.token}&date=${p.date}&time=${p.time}`;
}

export function cardPath(p: ShareParams): string {
  return `/api/share?${qs(p)}`;
}

export function pagePath(p: ShareParams): string {
  return `/s?${qs(p)}`;
}

// Reads and checks query values. Returns null when anything is off.
export function parseShareParams(q: { token?: string | null; date?: string | null; time?: string | null }): ShareParams | null {
  const token = Number(q.token);
  const time = Number(q.time);
  const date = q.date ?? "";
  if (!Number.isInteger(token) || token < 1 || token > PORTAL_SUPPLY) return null;
  if (!validDate(date)) return null;
  if (!Number.isInteger(time) || time < 0 || time > MAX_SHARE_SECONDS) return null;
  return { token, date, time };
}

export function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function shareText(name: string, p: ShareParams, cols: number, rows: number): string {
  return `I cleared ${name} (${cols}x${rows}) in ${formatTime(p.time)} on Portalsweeper, ${p.date}.`;
}

export function shortFingerprint(commit: string): string {
  return commit.length > 20 ? `${commit.slice(0, 10)}...${commit.slice(-8)}` : commit;
}
