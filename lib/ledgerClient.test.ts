import { describe, it, expect, afterEach, vi } from "vitest";
import { encodeFunctionData, type Hex, type PublicClient, type WalletClient } from "viem";
import { LEDGER_ABI, commitToLedger, dayNumber, fingerprintOfTx, ledgerAddress, readLedgerDay, revealToLedger } from "./ledger";
import { commitOf, dailyCommit, getDailySalt } from "./salt";

const ADDR = "0x1234567890123456789012345678901234567890";
const OLD = process.env.LEDGER_ADDRESS;
const OLD_SECRET = process.env.PORTAL_SALT_SECRET;
afterEach(() => {
  if (OLD === undefined) delete process.env.LEDGER_ADDRESS;
  else process.env.LEDGER_ADDRESS = OLD;
  if (OLD_SECRET === undefined) delete process.env.PORTAL_SALT_SECRET;
  else process.env.PORTAL_SALT_SECRET = OLD_SECRET;
});

describe("ledger client", () => {
  it("turns a date into the contract's day key", () => {
    expect(dayNumber("2026-11-05")).toBe(20261105);
    expect(() => dayNumber("5 Nov")).toThrow();
  });

  it("is off until LEDGER_ADDRESS is a real address", async () => {
    delete process.env.LEDGER_ADDRESS;
    expect(ledgerAddress()).toBeNull();
    process.env.LEDGER_ADDRESS = "nope";
    expect(ledgerAddress()).toBeNull();
    expect(await readLedgerDay("2026-11-05")).toBeNull();
    expect(await commitToLedger("2026-11-05", {} as WalletClient)).toBeNull();
    process.env.LEDGER_ADDRESS = ADDR;
    expect(ledgerAddress()).toBe(ADDR);
  });

  it("reads the fingerprint out of a ledger call, and leaves plain notes alone", () => {
    process.env.LEDGER_ADDRESS = ADDR;
    const fp = commitOf("0x" + "ab".repeat(32));
    const call = encodeFunctionData({ abi: LEDGER_ABI, functionName: "commit", args: [20261105, fp] });
    expect(fingerprintOfTx(call, ADDR)).toBe(fp);
    expect(fingerprintOfTx(call, ADDR.toUpperCase().replace("0X", "0x"))).toBe(fp);
    expect(fingerprintOfTx(fp, "0x6cE5b32C1747442ff480DC1ce60a2b229CCa0F82")).toBe(fp);
    delete process.env.LEDGER_ADDRESS;
    expect(fingerprintOfTx(call, ADDR)).toBe(call);
  });

  it("sends commit and reveal with the game's own fingerprint and salt", async () => {
    process.env.LEDGER_ADDRESS = ADDR;
    process.env.PORTAL_SALT_SECRET = "test-secret";
    const calls: { functionName: string; args: unknown[] }[] = [];
    const wallet = { account: { address: "0x1" }, writeContract: vi.fn(async (c: { functionName: string; args: unknown[] }) => (calls.push(c), "0xabc" as Hex)) } as unknown as WalletClient;
    const pub = { waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })) } as unknown as PublicClient;
    expect(await commitToLedger("2026-11-05", wallet, pub)).toBe("0xabc");
    expect(await revealToLedger("2026-11-05", wallet, pub)).toBe("0xabc");
    expect(calls[0]).toMatchObject({ functionName: "commit", args: [20261105, dailyCommit("2026-11-05")] });
    expect(calls[1]).toMatchObject({ functionName: "reveal", args: [20261105, getDailySalt("2026-11-05")] });
  });

  it("throws when the chain says the call failed", async () => {
    process.env.LEDGER_ADDRESS = ADDR;
    process.env.PORTAL_SALT_SECRET = "test-secret";
    const wallet = { account: { address: "0x1" }, writeContract: async () => "0xabc" } as unknown as WalletClient;
    const pub = { waitForTransactionReceipt: async () => ({ status: "reverted" }) } as unknown as PublicClient;
    await expect(commitToLedger("2026-11-05", wallet, pub)).rejects.toThrow(/failed/);
  });
});
