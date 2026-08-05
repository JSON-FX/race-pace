import { describe, it, expect } from "vitest";
import { EVENT_DISCIPLINES, DISCIPLINE_LABELS, DISCIPLINE_LAYOUT, disciplineLayout } from "./index";

describe("event disciplines", () => {
  it("labels and maps a layout for every discipline", () => {
    for (const d of EVENT_DISCIPLINES) {
      expect(DISCIPLINE_LABELS[d], `label for ${d}`).toBeTruthy();
      expect(["profile", "route"]).toContain(DISCIPLINE_LAYOUT[d]);
    }
  });
  it("routes terrain events to the elevation profile", () => {
    expect(disciplineLayout("trail")).toBe("profile");
    expect(disciplineLayout("ultra")).toBe("profile");
  });
  it("routes road events to the route ribbon", () => {
    expect(disciplineLayout("marathon")).toBe("route");
    expect(disciplineLayout("fun_run")).toBe("route");
  });
  it("falls back to profile for an unknown or missing value rather than crashing", () => {
    expect(disciplineLayout("kayaking")).toBe("profile");
    expect(disciplineLayout(null)).toBe("profile");
    expect(disciplineLayout(undefined)).toBe("profile");
  });
});
