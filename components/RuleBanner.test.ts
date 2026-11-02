import { describe, expect, it } from "vitest";
import { headlineRule } from "./RuleBanner";
import type { FiredRule } from "@/lib/types";

const rule = (id: FiredRule["id"]): FiredRule => ({ id, trait: "T", value: "V", why: "because" });

describe("headlineRule", () => {
  it("returns null when no rule fired", () => {
    expect(headlineRule([])).toBeNull();
  });
  it("announces a helpful rule before the board size", () => {
    expect(headlineRule([rule("tier-size"), rule("core-peek")])?.id).toBe("core-peek");
  });
  it("puts the Frame shield first", () => {
    expect(headlineRule([rule("tier-size"), rule("sigil-flag"), rule("frame-shield")])?.id).toBe("frame-shield");
  });
  it("falls back to the board size when it is the only rule", () => {
    expect(headlineRule([rule("tier-size")])?.id).toBe("tier-size");
  });
  it("does not change the list it is given", () => {
    const list = [rule("tier-size"), rule("frame-shield")];
    headlineRule(list);
    expect(list[0].id).toBe("tier-size");
  });
});
