// One number everywhere: the token number is the board id the player typed.
// The art's own name (for example "Pot #12") can differ, so it is shown only as a small label.
export const potLabel = (id: number): string => `Pot #${id}`;

export function artName(meta: { id: number; name: string }): string | null {
  const n = meta.name?.trim();
  return n && n.toLowerCase() !== potLabel(meta.id).toLowerCase() ? n : null;
}

// Accepts ?id= or ?token=, returns a valid Pot number or null.
export function potFromQuery(q: URLSearchParams, supply: number): number | null {
  for (const key of ["id", "token"]) {
    const raw = q.get(key);
    if (raw === null || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= supply) return n;
  }
  return null;
}
