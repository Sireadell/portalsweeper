import { defineChain } from "viem";
import { PORTALDOT_CHAIN_ID, PORTALDOT_RPC } from "./types";

// Portaldot V3 testnet, EVM side (pallet-revive). Native token tPOT; the EVM side shows it with 18 decimals.
export const portaldot = defineChain({
  id: PORTALDOT_CHAIN_ID,
  name: "Portaldot V3 Testnet",
  nativeCurrency: { name: "Portaldot", symbol: "tPOT", decimals: 18 },
  rpcUrls: { default: { http: [PORTALDOT_RPC] } },
});
