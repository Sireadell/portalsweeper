"use client";
import { useCallback, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { PORTALDOT_CHAIN_ID } from "@/lib/types";
import { portaldot } from "@/lib/portaldot";

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/reject|denied/i.test(msg) ? "You closed the wallet request. Press Connect to try again." : "Could not connect. Check your wallet and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { address, error, busy, connect, disconnect: () => setAddress(null) };
}
