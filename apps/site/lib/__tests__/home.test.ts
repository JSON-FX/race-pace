import { describe, it, expect } from "vitest";
import { homeMode } from "../home";

describe("homeMode", () => {
  it("is multi with exactly one registerable event — there is no longer a single-event mode", () => {
    expect(homeMode([{ status: "open" }])).toBe("multi");
  });

  it("is multi with a lone almost_full event — it is still registerable", () => {
    expect(homeMode([{ status: "almost_full" }])).toBe("multi");
  });

  it("is multi with two or more registerable events", () => {
    expect(homeMode([{ status: "open" }, { status: "almost_full" }])).toBe("multi");
  });

  it("is empty with zero events", () => {
    expect(homeMode([])).toBe("empty");
  });

  it("is empty when the only event is cancelled", () => {
    expect(homeMode([{ status: "cancelled" }])).toBe("empty");
  });

  it("is empty when every event is closed or completed, even several of them", () => {
    expect(homeMode([{ status: "closed" }, { status: "completed" }, { status: "cancelled" }])).toBe("empty");
  });

  it("counts only the registerable subset — one open among several closed is multi", () => {
    expect(homeMode([{ status: "closed" }, { status: "open" }, { status: "completed" }])).toBe("multi");
  });
});
