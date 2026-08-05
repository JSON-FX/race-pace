import { describe, it, expect } from "vitest";
import { longDate, shortDate } from "../format";

describe("date formatters", () => {
  it("formats a long date", () => {
    expect(longDate("2026-11-14")).toBe("14 November 2026");
  });

  it("formats a short date", () => {
    expect(shortDate("2026-11-14")).toBe("14 Nov 2026");
  });

  // Without `timeZone: "UTC"` in the formatter options, toLocaleDateString
  // renders in the host's local zone. Under a NEGATIVE UTC offset (e.g.
  // America/New_York, UTC-5), UTC midnight falls on the previous local day,
  // so "2026-01-01" would print as "31 December 2025". The test suite's
  // TZ is pinned to America/New_York (see apps/site/package.json's "test"
  // script) specifically so this case can fail. A positive offset (e.g.
  // Manila, UTC+8) can never reproduce this bug, since it only shifts UTC
  // midnight forward within the same local day.
  it("does not shift the day across timezones", () => {
    expect(longDate("2026-01-01")).toBe("1 January 2026");
  });
});
