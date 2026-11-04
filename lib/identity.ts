import type { ApiPromise } from "@polkadot/api";
import { hexToString } from "@polkadot/util";
import { mappedAccount } from "./native";

// A name set on Portaldot's identity pallet for a native account, or null. Read only.
export async function namesOfAccounts(api: ApiPromise, accounts: string[]): Promise<(string | null)[]> {
  if (!accounts.length) return [];
  const rows = (await api.query.identity.identityOf.multi(accounts)) as unknown as { isSome: boolean; unwrap(): unknown }[];
  return rows.map((o) => {
    if (!o.isSome) return null;
    const reg = o.unwrap() as unknown as { toJSON(): unknown };
    // Newer runtimes return [registration, username], older ones return the registration itself.
    const j = reg.toJSON() as { info?: { display?: { raw?: string } } } | [{ info?: { display?: { raw?: string } } }, unknown];
    const info = Array.isArray(j) ? j[0]?.info : j?.info;
    const raw = info?.display?.raw;
    return raw ? hexToString(raw).trim() || null : null;
  });
}

// Names for 0x wallets, in the same order. Wallets with no name give null.
export async function namesOfWallets(api: ApiPromise, wallets: string[]): Promise<(string | null)[]> {
  return namesOfAccounts(api, wallets.map(mappedAccount));
}
