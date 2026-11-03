// A small list of the challenges this browser has made or joined, kept per wallet in this browser only.
// The server is still the source of truth: the list stores ids, and each row asks the server for its state.
export type Remembered = { id: string; wallet: string; role: "creator" | "opponent"; at: number };
export type SavedResult = { won: boolean; seconds: number };

const KEY = "portalsweeper:my-challenges";
const MAX = 30;

function read(): Remembered[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string" && typeof r.wallet === "string") : [];
  } catch {
    return [];
  }
}

export function rememberChallenge(id: string, wallet: string, role: Remembered["role"]) {
  try {
    const w = wallet.toLowerCase();
    const all = read();
    const prev = all.find((r) => r.id === id && r.wallet === w);
    const rest = all.filter((r) => !(r.id === id && r.wallet === w));
    localStorage.setItem(KEY, JSON.stringify([{ id, wallet: w, role: prev?.role ?? role, at: prev?.at ?? Date.now() }, ...rest].slice(0, MAX)));
  } catch { /* storage may be blocked, the list is a convenience */ }
}

export function myChallenges(wallet: string): Remembered[] {
  const w = wallet.toLowerCase();
  return read().filter((r) => r.wallet === w).sort((a, b) => b.at - a.at);
}

export function forgetChallenge(id: string, wallet: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(read().filter((r) => !(r.id === id && r.wallet === wallet.toLowerCase()))));
  } catch { /* ignore */ }
}

// Your own result stays visible to you while you wait for the other player (the public view hides times).
export function saveMyResult(id: string, wallet: string, r: SavedResult) {
  try { localStorage.setItem(`portalsweeper:challenge-result:${id}:${wallet.toLowerCase()}`, JSON.stringify(r)); } catch { /* ignore */ }
}
export function getMyResult(id: string, wallet: string): SavedResult | null {
  try {
    const r = JSON.parse(localStorage.getItem(`portalsweeper:challenge-result:${id}:${wallet.toLowerCase()}`) ?? "null");
    return r && typeof r.seconds === "number" ? r : null;
  } catch {
    return null;
  }
}
