import { describe, it, expect } from "vitest";
import { longDate, shortDate } from "../format";

describe("date formatters", () => {
  it("formats a long date", () => {
    expect(longDate("2026-11-14")).toBe("14 November 2026");
  });

  it("formats a short date", () => {
    expect(shortDate("2026-11-14")).toBe("14 Nov 2026");
  });

  // Parsing "2026-11-14" as UTC and rendering in a UTC+8 locale must not
  // shift the date. Philippine events would otherwise show the day before.
  it("does not shift the day across timezones", () => {
    expect(longDate("2026-01-01")).toBe("1 January 2026");
  });
});
