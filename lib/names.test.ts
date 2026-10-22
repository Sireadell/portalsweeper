import { describe, expect, it } from "vitest";
import { artName, portalFromQuery, portalLabel } from "./names";

describe("names", () => {
  it("labels by token number", () => expect(portalLabel(7)).toBe("Portal #7"));
  it("shows the art name only when it differs", () => {
    expect(artName({ id: 7, name: "Portal #12" })).toBe("Portal #12");
    expect(artName({ id: 7, name: "Portal #7" })).toBeNull();
  });
  it("accepts id and token in the link", () => {
    expect(portalFromQuery(new URLSearchParams("id=7"), 500)).toBe(7);
    expect(portalFromQuery(new URLSearchParams("token=7"), 500)).toBe(7);
    expect(portalFromQuery(new URLSearchParams("id=0&token=9"), 500)).toBe(9);
    expect(portalFromQuery(new URLSearchParams("token=99999"), 500)).toBeNull();
    expect(portalFromQuery(new URLSearchParams(""), 500)).toBeNull();
  });
});
