import { describe, it, expect } from "vitest";
import { predictProcessorFee, grossUpCharge, type ProcessorRate } from "../functions/_shared/processorFee.ts";
import { pmFeeFromAttributes } from "../functions/_shared/paymongo.ts";

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

const session = (payments: unknown[]) => ({ payments });
const payment = (status: string, amount: number, fee: number, net: number) => ({
  id: `pay_${status}`, attributes: { status, amount, fee, net_amount: net },
});

describe("pmFeeFromAttributes", () => {
  it("reads fee and net_amount off the PAID payment", () => {
    expect(pmFeeFromAttributes(session([payment("paid", 200000, 3000, 197000)])))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
  });

  it("prefers the paid payment over an earlier failed attempt", () => {
    // A session can carry an abandoned attempt followed by a successful one.
    // payments[0] would report the instrument and fee the runner did NOT use.
    const s = session([
      payment("failed", 200000, 0, 0),
      payment("paid", 200000, 8500, 191500),
    ]);
    expect(pmFeeFromAttributes(s)).toEqual({ fee: 8500, netAmount: 191500, amount: 200000 });
  });

  it("returns null when there is no payment at all", () => {
    expect(pmFeeFromAttributes(session([]))).toBeNull();
    expect(pmFeeFromAttributes({})).toBeNull();
    expect(pmFeeFromAttributes(null)).toBeNull();
  });

  it("returns null when the fee field is absent — a known-unknown, not a zero", () => {
    // Reporting 0 here would be indistinguishable from a genuinely free payment
    // and would write a wrong net_to_org.
    expect(pmFeeFromAttributes(session([
      { id: "pay_x", attributes: { status: "paid", amount: 200000 } },
    ]))).toBeNull();
  });

  it("returns null when any ONE of the three figures is missing or mistyped", () => {
    // Each checked independently. `amount` matters as much as the other two:
    // the caller's integrity check is `amount - fee === net_amount`, so a
    // fabricated amount would make that check compare an invented number.
    const attrs = (over: Record<string, unknown>) =>
      session([{ id: "pay_x", attributes: { status: "paid", ...over } }]);

    expect(pmFeeFromAttributes(attrs({ fee: 3000, net_amount: 197000 }))).toBeNull();   // no amount
    expect(pmFeeFromAttributes(attrs({ amount: 200000, net_amount: 197000 }))).toBeNull(); // no fee
    expect(pmFeeFromAttributes(attrs({ amount: 200000, fee: 3000 }))).toBeNull();       // no net_amount
    // A numeric STRING is not a number — never coerce money.
    expect(pmFeeFromAttributes(attrs({ amount: "200000", fee: 3000, net_amount: 197000 }))).toBeNull();
    expect(pmFeeFromAttributes(attrs({ amount: 200000, fee: null, net_amount: 197000 }))).toBeNull();
  });
});
