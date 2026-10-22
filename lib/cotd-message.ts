// Kept apart from lib/cotd.ts so the browser can import it without pulling in server-only code.
// The sentence a wallet signs to claim its single ranked try for a day (no gas, no transaction).
export function cotdMessage(date: string): string {
  return `Potsweeper Pot of the day ${date}\nI am taking my one ranked try for this day.`;
}
