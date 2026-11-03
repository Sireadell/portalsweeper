// Kept apart from lib/challenge.ts so the browser can import it without pulling in server-only code.
// The sentences a wallet signs for a friend challenge (no gas, no transaction).
export function challengeCreateMessage(date: string): string {
  return `Portalsweeper friend challenge ${date}\nI am making a challenge and I will take my one try on it.`;
}

export function challengePlayMessage(id: string): string {
  return `Portalsweeper friend challenge ${id}\nI am taking my one try on this challenge.`;
}

export function challengeCancelMessage(id: string): string {
  return `Portalsweeper friend challenge ${id}
I am closing this challenge before anyone joins.`;
}
