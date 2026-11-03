import { describe, expect, it } from "vitest";
import { fromRoomCode, toRoomCode } from "./roomCode";

describe("room codes", () => {
  it("round trips an id", () => {
    expect(toRoomCode("a1b2c3d4e5f6")).toBe("A1B2-C3D4-E5F6");
    expect(fromRoomCode("A1B2-C3D4-E5F6")).toBe("a1b2c3d4e5f6");
    expect(fromRoomCode(" a1b2 c3d4 e5f6 ")).toBe("a1b2c3d4e5f6");
  });
  it("rejects anything that is not 12 hex characters", () => {
    expect(fromRoomCode("A1B2-C3D4")).toBeNull();
    expect(fromRoomCode("zzzz-zzzz-zzzz")).toBeNull();
    expect(fromRoomCode("")).toBeNull();
  });
});
