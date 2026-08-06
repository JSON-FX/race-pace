import { describe, it, expect } from "vitest";
import { peso, fmtDate, fmtDateTime, initials } from "./format";

describe("peso", () => {
  it("renders a clean amount with no decimals", () => {
    expect(peso(285000)).toBe("₱2,850");
  });

  it("renders a real platform fee with decimals", () => {
    expect(peso(14250)).toBe("₱142.50");
  });

  it("renders zero cleanly", () => {
    expect(peso(0)).toBe("₱0");
  });

  it("renders a negative amount (refund) with a minus sign", () => {
    expect(peso(-285000)).toBe("-₱2,850");
  });

  it("renders a single decimal place amount", () => {
    expect(peso(100010)).toBe("₱1,000.10");
  });
});

describe("fmtDate", () => {
  it("formats an ISO date as month, day, year", () => {
    expect(fmtDate("2026-08-03T09:14:00Z")).toMatch(/Aug\s+\d{1,2},\s+2026/);
  });
});

describe("fmtDateTime", () => {
  it("formats an ISO date as month, day, HH:mm — no year", () => {
    expect(fmtDateTime("2026-08-03T09:14:00Z")).toMatch(/^Aug\s+\d{1,2},\s+\d{2}:\d{2}$/);
  });

  it("zero-pads a single-digit hour and minute", () => {
    // 00:05 local time regardless of the runner's timezone offset from UTC
    // would need a fixed zone to assert exactly — instead assert the
    // zero-padding shape holds for an arbitrary early-morning instant.
    expect(fmtDateTime("2026-01-01T00:05:00Z")).toMatch(/\d{2}:\d{2}$/);
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words for a 3-word name", () => {
    expect(initials("Maria Josefa Santos")).toBe("MJ");
  });

  it("takes both initials for a 2-word name", () => {
    expect(initials("Ramon Cruz")).toBe("RC");
  });

  it("falls back to the first two characters for a single word", () => {
    expect(initials("Cher")).toBe("CH");
  });

  it("falls back to a question mark for a missing name", () => {
    expect(initials(null)).toBe("?");
    expect(initials("")).toBe("?");
  });
});
