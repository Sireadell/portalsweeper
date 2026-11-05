// Kept apart from lib/cotd.ts so the browser can import it without pulling in server-only code.
// The sentence a wallet signs to claim its single ranked try for a day (no gas, no transaction).
export function cotdMessage(date: string): string {
  return `Portalsweeper Portal of the day ${date}\nI am taking my one ranked try for this day.`;
}

// The sentence a wallet signs to let anyone watch its ranked try (15 seconds late). No gas, no transaction.
export function broadcastMessage(date: string): string {
  return `Portalsweeper broadcast ${date}
I am letting anyone watch my ranked try, 15 seconds late. No fee, no transaction.`;
}
