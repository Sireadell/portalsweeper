"use client";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { PORTALDOT_CHAIN_ID } from "@/lib/types";
import { portaldot } from "@/lib/portaldot";

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

const KEY = "portalsweeper:wallet-connected";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Connected on another page of this visit? Pick the same account up again without asking, so the wallet
  // does not have to be connected twice (for example right after making a challenge).
  useEffect(() => {
    let flagged = false;
    try { flagged = sessionStorage.getItem(KEY) === "1"; } catch { /* storage may be blocked */ }
    const eth = window.ethereum;
    if (!flagged || !eth) return;
    let live = true;
    Promise.resolve(eth.request({ method: "eth_accounts" })).then((accts) => {
      const a = (accts as string[] | undefined)?.[0];
      if (live && a) setAddress(a);
    }).catch(() => { /* leave it disconnected */ });
    return () => { live = false; };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth) {
      setError("No wallet found in this browser. Install a wallet like MetaMask, SubWallet or Talisman, or try Judge mode, which needs no wallet.");
      return;
    }
    setBusy(true);
    try {
      const client = createWalletClient({ chain: portaldot, transport: custom(eth) });
      const [addr] = await client.requestAddresses();
      const current = await client.getChainId();
      if (current !== PORTALDOT_CHAIN_ID) {
        try {
          await client.switchChain({ id: PORTALDOT_CHAIN_ID });
        } catch {
          await client.addChain({ chain: portaldot });
          await client.switchChain({ id: PORTALDOT_CHAIN_ID });
        }
      }
      setAddress(addr);
      try { sessionStorage.setItem(KEY, "1"); } catch { /* fine */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/reject|denied/i.test(msg) ? "You closed the wallet request. Press Connect to try again." : "Could not connect. Check your wallet and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { address, error, busy, connect, disconnect: () => { try { sessionStorage.removeItem(KEY); } catch { /* fine */ } setAddress(null); } };
}
