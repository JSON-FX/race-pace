import { describe, it, expect } from "vitest";
import { predictProcessorFee, grossUpCharge, type ProcessorRate } from "../functions/_shared/processorFee.ts";

const CARD: ProcessorRate = { percent_bps: 350, fixed_cents: 1500 };
const GCASH: ProcessorRate = { percent_bps: 150, fixed_cents: 0 };
const INTL: ProcessorRate = { percent_bps: 450, fixed_cents: 1500 };

describe("predictProcessorFee", () => {
  it("takes a percentage plus a fixed amount", () => {
    // 3.5% of ₱2,000 = ₱70, + ₱15 = ₱85
    expect(predictProcessorFee(200000, CARD)).toBe(8500);
  });

  it("takes a bare percentage when there is no fixed component", () => {
    expect(predictProcessorFee(200000, GCASH)).toBe(3000);
  });

  it("rounds to whole centavos", () => {
    expect(predictProcessorFee(33333, GCASH)).toBe(500); // 499.995 -> 500
  });

  it("charges nothing on a zero amount", () => {
    expect(predictProcessorFee(0, CARD)).toBe(0);
    expect(predictProcessorFee(0, GCASH)).toBe(0);
  });
});

describe("grossUpCharge", () => {
  it("covers the processor's cut on the LARGER total, not the base", () => {
    // Target ₱2,060 must survive a 3.5% + ₱15 deduction.
    // Naive addition gives ₱2,147.10 and comes up ₱3.16 short every time.
    expect(grossUpCharge(206000, CARD)).toBe(215026);
  });

  it("grosses up a percentage-only rate", () => {
    expect(grossUpCharge(206000, GCASH)).toBe(209138);
  });

  it("ROUND-TRIPS: charge minus the processor's actual cut always covers the target", () => {
    const rates = [CARD, GCASH, INTL, { percent_bps: 80, fixed_cents: 0 }];
    const targets = [1, 100, 5000, 206000, 1000000, 33333, 99999];
    for (const rate of rates) {
      for (const target of targets) {
        const charge = grossUpCharge(target, rate);
        const fee = predictProcessorFee(charge, rate);
        // Never a shortfall. The ceil puts the sub-centavo remainder on the
        // organizer's side, so at most ₱0.01 over — never under.
        expect(charge - fee).toBeGreaterThanOrEqual(target);
        expect(charge - fee).toBeLessThanOrEqual(target + 1);
      }
    }
  });

  it("returns zero for a zero target", () => {
    expect(grossUpCharge(0, CARD)).toBe(0);
  });

  it("throws rather than inverting when a rate is 100% or more", () => {
    // 1 / (1 - 1.0) is a division by zero; anything above is a NEGATIVE charge.
    // A silently negative charge is money moving the wrong way.
    expect(() => grossUpCharge(200000, { percent_bps: 10000, fixed_cents: 0 })).toThrow();
    expect(() => grossUpCharge(200000, { percent_bps: 12000, fixed_cents: 0 })).toThrow();
  });
});
