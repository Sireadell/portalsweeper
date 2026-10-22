import { describe, expect, it } from "vitest";
import { proofBadge, verifyPath } from "./proofBadge";

const commit = "0x" + "ab".repeat(32);

describe("proof badge", () => {
  it("links to the verify page with date and token", () => {
    expect(verifyPath("2026-10-20", 7)).toBe("/verify?date=2026-10-20&token=7");
    expect(proofBadge({ date: "2026-10-20", token: 7, commit, posted: true }).verifyPath).toBe("/verify?date=2026-10-20&token=7");
  });
  it("shortens the fingerprint", () => {
    expect(proofBadge({ date: "2026-10-20", token: 7, commit, posted: true }).fingerprint).toMatch(/^0x.{8}\.\.\..{8}$/);
  });
  it("only claims a Portaldot post when one exists", () => {
    const yes = proofBadge({ date: "2026-10-20", token: 7, commit, posted: true });
    const no = proofBadge({ date: "2026-10-20", token: 7, commit, posted: false });
    expect(yes.detail).toMatch(/posted on Portaldot before/);
    expect(no.detail).toMatch(/has not been posted/);
    expect(no.detail).not.toMatch(/could not be changed/);
  });
  it("never uses an em dash", () => {
    const b = proofBadge({ date: "2026-10-20", token: 7, commit, posted: true });
    expect(b.headline + b.detail).not.toContain("—");
  });
});
