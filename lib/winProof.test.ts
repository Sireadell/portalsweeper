import { describe, it, expect } from "vitest";
import { moveLogHash, moveLogText } from "./winProof";
import type { StoredMove } from "./records";

const moves: StoredMove[] = [
  { action: "reveal", idx: 12, t: 1000 },
  { action: "flag", idx: 3, t: 2500 },
  { action: "chord", idx: 12, t: 4100 },
];

describe("moveLogHash", () => {
  it("writes one line per move in order", () => {
    expect(moveLogText(moves)).toBe("reveal:12:1000\nflag:3:2500\nchord:12:4100");
  });
  it("gives the same fingerprint for the same moves", () => {
    expect(moveLogHash(moves)).toBe(moveLogHash(moves.map((m) => ({ ...m }))));
    expect(moveLogHash(moves)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("changes when one move changes or the order changes", () => {
    const base = moveLogHash(moves);
    expect(moveLogHash([{ ...moves[0], idx: 13 }, ...moves.slice(1)])).not.toBe(base);
    expect(moveLogHash([...moves].reverse())).not.toBe(base);
    expect(moveLogHash([])).not.toBe(base);
  });
});
