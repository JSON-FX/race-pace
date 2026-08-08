import { describe, it, expect } from "vitest";
import { kitEditLocked, daysUntil } from "../kit";

describe("kitEditLocked", () => {
  it("is unlocked when there is no deadline", () => {
    expect(kitEditLocked(null)).toBe(false);
  });
  it("is unlocked before the deadline", () => {
    expect(kitEditLocked("2099-01-01T00:00:00Z")).toBe(false);
  });
  it("is locked after the deadline", () => {
    expect(kitEditLocked("2020-01-01T00:00:00Z")).toBe(true);
  });
});

describe("daysUntil", () => {
  it("counts whole days remaining, rounding up so 'today' reads as 1", () => {
    const soon = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    expect(daysUntil(soon)).toBe(2);
  });
  it("returns 0 once the instant has passed", () => {
    expect(daysUntil("2020-01-01T00:00:00Z")).toBe(0);
  });
});
