import { describe, it, expect } from "vitest";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { multisigAddress, otherSignatories, multisigDeposit } from "./multisig-lib";

async function three() {
  await cryptoWaitReady();
  const k = new Keyring({ type: "sr25519", ss58Format: 42 });
  return ["//Alice", "//Bob", "//Charlie"].map((u) => k.addFromUri(u).address);
}

describe("multisig helpers", () => {
  it("gives the same address in any signer order, and a different one for another threshold", async () => {
    const [a, b, c] = await three();
    expect(multisigAddress([a, b, c], 2)).toBe(multisigAddress([c, a, b], 2));
    expect(multisigAddress([a, b, c], 2)).not.toBe(multisigAddress([a, b, c], 3));
  });
  it("refuses bad setups", async () => {
    const [a, b] = await three();
    expect(() => multisigAddress([a], 2)).toThrow();
    expect(() => multisigAddress([a, a], 2)).toThrow();
    expect(() => multisigAddress([a, b], 3)).toThrow();
    expect(() => multisigAddress([a, b], 1)).toThrow();
  });
  it("lists the other signers without the caller", async () => {
    const [a, b, c] = await three();
    const o = otherSignatories([a, b, c], b);
    expect(o).toHaveLength(2);
    expect(o).not.toContain(b);
    expect(() => otherSignatories([a, c], b)).toThrow();
  });
  it("adds the deposit per signer", () => {
    expect(multisigDeposit(543n, 192n, 3)).toBe(543n + 576n);
  });
});
