import { describe, it, expect } from "vitest";
import { decodeMatch, matchId, escrowContractAddress, MATCH_STATUS } from "./escrow";

describe("escrow helpers", () => {
  it("matchId is a 32 byte hash and differs by challenge", () => {
    expect(matchId("abc")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(matchId("abc")).not.toBe(matchId("abd"));
    expect(matchId("abc")).toBe(matchId("abc"));
  });
  it("decodes a match and its status name", () => {
    const m = decodeMatch(["0xa", "0xb", 5n, 99n, 2]);
    expect(m).toEqual({ creator: "0xa", opponent: "0xb", amountWei: 5n, deadline: 99, status: "locked" });
    expect(MATCH_STATUS[4]).toBe("refunded");
  });
  it("reads the contract address only when it is a real address", () => {
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    expect(escrowContractAddress()).toBeNull();
    process.env.ESCROW_CONTRACT_ADDRESS = "nonsense";
    expect(escrowContractAddress()).toBeNull();
    process.env.ESCROW_CONTRACT_ADDRESS = "0x9cebe7c313b0c86c55d956a3d07bd191fddabf9a";
    expect(escrowContractAddress()).toBe("0x9cebe7c313b0c86c55d956a3d07bd191fddabf9a");
    delete process.env.ESCROW_CONTRACT_ADDRESS;
  });
});

import { portaldotContractStakeChain, stakeChainFromEnv } from "./stakeChain";
describe("contract stake chain", () => {
  it("uses the contract address as the escrow address and refuses plain sends", async () => {
    process.env.ESCROW_CONTRACT_ADDRESS = "0x9cebe7c313b0c86c55d956a3d07bd191fddabf9a";
    const c = portaldotContractStakeChain();
    expect(c.escrowAddress()).toBe("0x9cebe7c313b0c86c55d956a3d07bd191fddabf9a");
    await expect(c.send("0x1", 1n)).rejects.toThrow(/settle or refundAll/);
    expect("settle" in stakeChainFromEnv()).toBe(true);
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    expect("settle" in stakeChainFromEnv()).toBe(false);
  });
});
