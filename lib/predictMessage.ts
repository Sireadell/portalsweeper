// Kept apart from lib/predictions.ts so the browser can import it without pulling in server-only code.
// The sentence the race creator signs to open backing on their race (no gas, no transaction).
export function eventOpenMessage(id: string): string {
  return `Portalsweeper backing event ${id}\nI made this race and I am opening backing on it. Backing uses testnet coins with no value.`;
}
