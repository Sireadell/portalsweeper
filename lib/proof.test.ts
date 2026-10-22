import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { checkProof } from "./proof";
import type { PortalMeta } from "./types";

const meta: PortalMeta = { id: 7, name: "Portal #7", image: "", traits: [{ trait_type: "Tier", value: "Common" }] };
const salt = "0x" + "11".repeat(32);
const commit = keccak256(toBytes(salt));
const date = "2026-10-18";
const posted = { found: true, data: commit, timestamp: Date.parse("2026-10-18T06:00:00Z") / 1000, txHash: "0xabc" };

describe("checkProof", () => {
  it("passes when secret, board and Portaldot post agree", () => {
    const r = checkProof({ date, commit, salt, meta, chain: posted });
    expect(r.verdict).toBe("pass");
    expect(r.board?.cols).toBe(8);
  });
  it("fails on a wrong secret", () => {
    expect(checkProof({ date, commit, salt: "0x" + "22".repeat(32), meta, chain: posted }).verdict).toBe("fail");
  });
  it("fails when posted after the day ended", () => {
    const late = { ...posted, timestamp: Date.parse("2026-10-19T01:00:00Z") / 1000 };
    expect(checkProof({ date, commit, salt, meta, chain: late }).verdict).toBe("fail");
  });
  it("is partial when nothing was posted on Portaldot", () => {
    expect(checkProof({ date, commit, salt, meta, chain: { found: false } }).verdict).toBe("partial");
  });
  it("waits honestly while the day is live", () => {
    expect(checkProof({ date, commit, salt: null, meta, chain: { found: false } }).verdict).toBe("wait");
    expect(checkProof({ date, commit, salt: null, meta, chain: { found: true, data: "0xdead" } }).verdict).toBe("fail");
  });
});
