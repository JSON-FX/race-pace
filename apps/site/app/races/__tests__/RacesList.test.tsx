import { describe, it, expect } from "vitest";
import { holdRemaining } from "../RacesList";

describe("holdRemaining", () => {
  it("returns null when there is no expiry (paid, or no hold)", () => {
    expect(holdRemaining(null)).toBeNull();
  });

  it("returns null once the hold has lapsed — never shows a countdown the server already killed", () => {
    // The list's own fetch doesn't re-apply the lazy-expiry check the way
    // lib/entry.ts does, so a pending row can still be in the data moments
    // before the 15-minute sweep catches it. The countdown must not claim a
    // live hold in that window.
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(holdRemaining(past)).toBeNull();
  });

  it("reports whole hours, not urgent, for anything an hour or more out", () => {
    const in23h = new Date(Date.now() + 23 * 3_600_000 + 5 * 60_000).toISOString();
    expect(holdRemaining(in23h)).toEqual({ label: "23h left to pay", urgent: false });
  });

  it("floors to the hour rather than rounding up", () => {
    // 1h59m left must read "1h", not "2h" — rounding up would overstate the
    // hold and round down to the wrong bucket right at the urgent threshold.
    const in1h59 = new Date(Date.now() + 1 * 3_600_000 + 59 * 60_000).toISOString();
    expect(holdRemaining(in1h59)).toEqual({ label: "1h left to pay", urgent: false });
  });

  it("switches to minutes and marks urgent once under an hour", () => {
    const in45m = new Date(Date.now() + 45 * 60_000).toISOString();
    expect(holdRemaining(in45m)).toEqual({ label: "45m left to pay", urgent: true });
  });

  it("never reports 0m for a hold that has not actually lapsed", () => {
    // A hold with e.g. 20 seconds left rounds to 0m by plain arithmetic;
    // clamping to a minimum of 1m keeps the copy ("0m left to pay") from
    // reading as already-expired when it technically is not yet.
    const in20s = new Date(Date.now() + 20_000).toISOString();
    expect(holdRemaining(in20s)).toEqual({ label: "1m left to pay", urgent: true });
  });
});
