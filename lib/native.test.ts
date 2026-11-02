import { describe, expect, it } from "vitest";
import { decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { mappedAccount, recipientAccount, walletOf } from "./native";

const W = "0x" + "ab".repeat(20);
const ISSUER = "5GxegAnxmYtA8EQXCCuSy5KTJu7fLsR6THtXpx7bw3P6yeqc";

describe("who a Portal is minted to", () => {
  it("maps an 0x wallet to its Portaldot account and back", () => {
    const acct = recipientAccount(W);
    expect(acct).toBe(mappedAccount(W));
    expect(u8aToHex(decodeAddress(acct))).toBe(W + "ee".repeat(12));
    expect(walletOf(acct)).toBe(W);
  });

  it("accepts a Portaldot (SS58) account as it is", () => {
    expect(recipientAccount(ISSUER)).toBe(ISSUER);
    expect(recipientAccount(`  ${ISSUER} `)).toBe(ISSUER);
  });

  it("rejects anything else", () => {
    expect(() => recipientAccount("0x1234")).toThrow(/valid/);
    expect(() => recipientAccount("hello")).toThrow(/valid/);
    expect(() => recipientAccount("")).toThrow(/valid/);
  });
});
