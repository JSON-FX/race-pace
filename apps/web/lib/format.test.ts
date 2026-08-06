import { describe, it, expect } from "vitest";
import { peso, fmtDate } from "./format";

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
