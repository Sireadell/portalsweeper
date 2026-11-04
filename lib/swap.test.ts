import { describe, expect, it } from "vitest";
import type { ApiPromise } from "@polkadot/api";
import { cancelSwapCall, claimSwapCall, createSwapCall, ethCallData, SWAP_DEFAULT_BLOCKS } from "./swap";

const seen: unknown[][] = [];
const rec = (name: string) => (...a: unknown[]) => { seen.push([name, ...a]); return { method: { toHex: () => "0x" + "ab".repeat(4) } }; };
const api = {
  consts: { nfts: { maxDeadlineDuration: { toString: () => "5184000" } } },
  tx: { nfts: { createSwap: rec("createSwap"), claimSwap: rec("claimSwap"), cancelSwap: rec("cancelSwap") } },
} as unknown as ApiPromise;

describe("Portal swaps", () => {
  it("offers one Portal for another for 7 days by default", () => {
    seen.length = 0;
    createSwapCall(api, { give: 12, want: 99, collection: 5 });
    expect(seen[0]).toEqual(["createSwap", 5, 12, 5, 99, null, SWAP_DEFAULT_BLOCKS]);
  });
  it("claims with the Portal that was asked for", () => {
    seen.length = 0;
    claimSwapCall(api, { send: 99, receive: 12, collection: 5 });
    expect(seen[0]).toEqual(["claimSwap", 5, 99, 5, 12, null]);
    cancelSwapCall(api, 12, 5);
  });
  it("refuses bad input", () => {
    expect(() => createSwapCall(api, { give: 0, want: 2, collection: 5 })).toThrow();
    expect(() => createSwapCall(api, { give: 3, want: 3, collection: 5 })).toThrow(/itself/);
    expect(() => createSwapCall(api, { give: 3, want: 501, collection: 5 })).toThrow();
    expect(() => createSwapCall(api, { give: 3, want: 4, collection: 5, blocks: 5_184_001 })).toThrow(/blocks/);
    expect(() => createSwapCall(api, { give: 3, want: 4, collection: -1 })).toThrow(/collection/);
  });
  it("gives the bytes for the Ethereum transaction data", () => {
    expect(ethCallData(createSwapCall(api, { give: 1, want: 2, collection: 5 }))).toBe("0xabababab");
  });
});
