import { beforeAll, describe, expect, it } from "vitest";
import type { ApiPromise } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, signatureVerify } from "@polkadot/util-crypto";
import { hexToU8a } from "@polkadot/util";
import { mintPreSignedCall, signTicket } from "./presigned";

const wallet = "0x" + "c3".repeat(20);
let lastBytes: Uint8Array = new Uint8Array();
const api = {
  createType: (_t: string, d: unknown) => ({ toU8a: () => (lastBytes = new TextEncoder().encode(JSON.stringify(d))) }),
  tx: { nfts: { mintPreSigned: (...a: unknown[]) => ({ args: a }) } },
} as unknown as ApiPromise;

describe("pre-signed mint ticket", () => {
  let issuer: ReturnType<Keyring["addFromUri"]>;
  beforeAll(async () => {
    await cryptoWaitReady();
    issuer = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri("//Alice");
  });
  it("signs the ticket so the issuer's signature verifies, and names only the winner", () => {
    const t = signTicket(api, issuer, { portal: 7, winner: wallet, deadlineBlock: 1000, collection: 5 });
    expect(t.mintData).toMatchObject({ collection: 5, item: 7, onlyAccount: t.winnerAccount, deadline: 1000, mintPrice: null });
    expect(signatureVerify(lastBytes, hexToU8a(t.signature.Sr25519), issuer.address).isValid).toBe(true);
    expect(mintPreSignedCall(api, t)).toMatchObject({ args: [t.mintData, t.signature, issuer.address] });
  });
  it("refuses bad input", () => {
    expect(() => signTicket(api, issuer, { portal: 0, winner: wallet, deadlineBlock: 10, collection: 5 })).toThrow();
    expect(() => signTicket(api, issuer, { portal: 1, winner: "nope", deadlineBlock: 10, collection: 5 })).toThrow();
    expect(() => signTicket(api, issuer, { portal: 1, winner: wallet, deadlineBlock: 0, collection: 5 })).toThrow();
  });
});
