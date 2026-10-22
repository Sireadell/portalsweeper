import { describe, expect, it } from "vitest";
import { artName, potFromQuery, potLabel } from "./names";

describe("names", () => {
  it("labels by token number", () => expect(potLabel(7)).toBe("Pot #7"));
  it("shows the art name only when it differs", () => {
    expect(artName({ id: 7, name: "Pot #12" })).toBe("Pot #12");
    expect(artName({ id: 7, name: "Pot #7" })).toBeNull();
  });
  it("accepts id and token in the link", () => {
    expect(potFromQuery(new URLSearchParams("id=7"), 500)).toBe(7);
    expect(potFromQuery(new URLSearchParams("token=7"), 500)).toBe(7);
    expect(potFromQuery(new URLSearchParams("id=0&token=9"), 500)).toBe(9);
    expect(potFromQuery(new URLSearchParams("token=99999"), 500)).toBeNull();
    expect(potFromQuery(new URLSearchParams(""), 500)).toBeNull();
  });
});
