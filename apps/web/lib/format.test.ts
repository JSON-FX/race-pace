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

describe("date formatting is timezone-stable", () => {
  // The regression these lock down: fmtDate/fmtDateTime used the RUNTIME's own
  // zone, so the UTC server and a Manila browser disagreed. React reported a
  // hydration mismatch and, more importantly, a payment briefly showed the
  // wrong DAY. Asserting against fixed strings means a future edit that drops
  // the pinned timeZone fails here rather than in production.

  it("renders an instant late in the UTC day as the NEXT Manila day", () => {
    // 2026-08-06T17:30Z is 2026-08-07 01:30 in Manila (UTC+8).
    expect(fmtDate("2026-08-06T17:30:00Z")).toBe("Aug 7, 2026");
  });

  it("renders an instant early in the UTC day as the same Manila day", () => {
    expect(fmtDate("2026-08-06T02:00:00Z")).toBe("Aug 6, 2026");
  });

  it("is unaffected by the process timezone", () => {
    // Simulates the server/client split directly: same input, two runtimes.
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const asUtc = fmtDate("2026-08-06T17:30:00Z");
      process.env.TZ = "America/New_York";
      const asNy = fmtDate("2026-08-06T17:30:00Z");
      expect(asUtc).toBe(asNy);
    } finally {
      process.env.TZ = original;
    }
  });

  it("renders the time in Manila, zero-padded", () => {
    expect(fmtDateTime("2026-08-06T17:30:00Z")).toBe("Aug 7, 01:30");
  });

  it("renders Manila midnight as 00:00, never 24:00", () => {
    // 2026-08-06T16:00Z is exactly 2026-08-07 00:00 Manila — the ICU quirk the
    // original getHours() implementation existed to avoid.
    expect(fmtDateTime("2026-08-06T16:00:00Z")).toBe("Aug 7, 00:00");
  });
});
