import { namesOfWallets } from "./identity";
import { getApi } from "./native";

// On-chain names (Portaldot's Identity module) for the wallets on the Hall. Read only.
// A wallet with no name, or any trouble reaching the chain, simply gives no entry, so the Hall always draws.
export async function hallNames(
  wallets: string[],
  read: (w: string[]) => Promise<(string | null)[]> = async (w) => namesOfWallets(await getApi(), w),
  timeoutMs = 4000,
): Promise<Map<string, string>> {
  const uniq = [...new Set(wallets.map((w) => w.toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)))];
  const out = new Map<string, string>();
  if (!uniq.length) return out;
  try {
    const names = await Promise.race([
      read(uniq),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    names.forEach((n, i) => {
      if (n) out.set(uniq[i], n.slice(0, 32));
    });
  } catch {
    // names are a bonus; ignore
  }
  return out;
}
