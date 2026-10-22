import { describe, expect, it } from "vitest";
import { cardPath, formatTime, pagePath, parseShareParams, shareText, shortFingerprint } from "./share";

describe("share urls", () => {
  const p = { token: 7, date: "2026-10-20", time: 95 };
  it("builds card and page paths with only token, date and time", () => {
    expect(cardPath(p)).toBe("/api/share?token=7&date=2026-10-20&time=95");
    expect(pagePath(p)).toBe("/s?token=7&date=2026-10-20&time=95");
    expect(pagePath(p)).not.toMatch(/0x|address|wallet/i);
  });
  it("round-trips through the parser", () => {
    const u = new URL("http://x" + pagePath(p));
    expect(parseShareParams({ token: u.searchParams.get("token"), date: u.searchParams.get("date"), time: u.searchParams.get("time") })).toEqual(p);
  });
  it("rejects bad values", () => {
    expect(parseShareParams({ token: "0", date: "2026-10-20", time: "5" })).toBeNull();
    expect(parseShareParams({ token: "1970", date: "2026-10-20", time: "5" })).toBeNull();
    expect(parseShareParams({ token: "5", date: "2026-13-40", time: "5" })).toBeNull();
    expect(parseShareParams({ token: "5", date: "2026-10-20", time: "-1" })).toBeNull();
    expect(parseShareParams({ token: "5", date: "2026-10-20", time: "99999" })).toBeNull();
    expect(parseShareParams({ token: null, date: null, time: null })).toBeNull();
  });
  it("formats text", () => {
    expect(formatTime(95)).toBe("1:35");
    expect(shareText("Portal #7", p, 8, 8)).toContain("8x8");
    expect(shortFingerprint("0x" + "ab".repeat(32))).toMatch(/^0x.{8}\.\.\..{8}$/);
  });
});
