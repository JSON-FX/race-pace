import { describe, it, expect } from "vitest";
import { computeFee } from "../functions/_shared/fee.ts";

const pct = (r: number | null) => ({ commission_type: "percent", commission_rate: r, commission_flat_cents: 0 });
const flat = (c: number) => ({ commission_type: "fixed", commission_rate: null, commission_flat_cents: c });

describe("computeFee", () => {
  it("takes a percentage of the entry", () => {
    expect(computeFee(200000, pct(0.10))).toBe(20000);
  });

  it("rounds a percentage to whole centavos", () => {
    expect(computeFee(33333, pct(0.10))).toBe(3333);
  });

  it("takes a flat amount regardless of entry price", () => {
    expect(computeFee(200000, flat(7500))).toBe(7500);
    expect(computeFee(150000, flat(7500))).toBe(7500);
  });

  it("CLAMPS a flat fee that exceeds the entry — net must never go negative", () => {
    // A ₱75 flat fee on a ₱60 entry would otherwise make net_to_org -₱15: the
    // organizer owing the platform money for a sale they made.
    expect(computeFee(6000, flat(7500))).toBe(6000);
  });

  it("clamps a mis-entered rate above 100% too", () => {
    expect(computeFee(200000, pct(1.5))).toBe(200000);
  });

  it("charges nothing on a zero-value entry", () => {
    expect(computeFee(0, flat(7500))).toBe(0);
    expect(computeFee(0, pct(0.10))).toBe(0);
  });

  it("falls back to 10% when a percent org has no rate", () => {
    expect(computeFee(200000, pct(null))).toBe(20000);
  });

  it("keeps fee + net === total, and both non-negative, for every case", () => {
    const cases = [
      [200000, pct(0.10)], [33333, pct(0.075)], [6000, flat(7500)],
      [0, flat(500)], [99, pct(0.10)], [200000, pct(1.5)], [1, flat(1)],
    ] as const;
    for (const [total, terms] of cases) {
      const fee = computeFee(total, terms);
      const net = total - fee;
      expect(fee + net).toBe(total);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(net).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(fee)).toBe(true);
    }
  });
});
