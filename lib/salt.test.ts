import { describe, expect, it, beforeAll } from "vitest";
import { keccak256, toBytes } from "viem";
import { addDays, commitOf, dailyCommit, getDailySalt, isRevealable, isValidDate } from "./salt";

beforeAll(() => {
  process.env.POT_SALT_SECRET = "test-secret-not-real";
});

describe("salt", () => {
  it("is the same for the same date and different across dates", () => {
    expect(getDailySalt("2026-10-20")).toBe(getDailySalt("2026-10-20"));
    expect(getDailySalt("2026-10-20")).not.toBe(getDailySalt("2026-10-21"));
    expect(getDailySalt("2026-10-20")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("commit is keccak256 of the salt", () => {
    const s = getDailySalt("2026-10-20");
    expect(dailyCommit("2026-10-20")).toBe(keccak256(toBytes(s)));
    expect(commitOf(s)).toBe(dailyCommit("2026-10-20"));
  });

  it("changes when the secret changes", () => {
    const a = getDailySalt("2026-10-20");
    process.env.POT_SALT_SECRET = "other";
    expect(getDailySalt("2026-10-20")).not.toBe(a);
    process.env.POT_SALT_SECRET = "test-secret-not-real";
  });

  it("does not reveal early", () => {
    expect(isRevealable("2026-10-20", new Date("2026-10-20T00:00:00Z"))).toBe(false);
    expect(isRevealable("2026-10-20", new Date("2026-10-20T23:59:59.999Z"))).toBe(false);
    expect(isRevealable("2026-10-20", new Date("2026-10-19T12:00:00Z"))).toBe(false);
    expect(isRevealable("2026-10-20", new Date("2026-10-21T00:00:00Z"))).toBe(true);
  });

  it("rejects bad dates", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("nope")).toBe(false);
    expect(() => getDailySalt("2026-13-01")).toThrow();
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
