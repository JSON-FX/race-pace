import { describe, it, expect } from "vitest";
import {
  predictProcessorFee,
  grossUpCharge,
  passOnBreakdown,
  type ProcessorRate,
} from "../functions/_shared/processorFee.ts";
import { pmFeeFromAttributes } from "../functions/_shared/paymongo.ts";
import { computeFee } from "../functions/_shared/fee.ts";
// The RUNNER-FACING duplicates of the two functions above, imported here so the
// duplication is pinned rather than merely commented — see the block at the
// bottom of this file for why the import goes in this direction and not the
// other.
import { passOnLines, feeOn } from "../../apps/site/lib/payment";

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

// The worked examples below are also asserted, as literals, in
// apps/site/lib/__tests__/payment.test.ts against that app's own copy of this
// formula. IF ANY NUMBER BELOW MOVES, the site copy has to move with it — a
// breakdown that disagrees with the charge is a runner quoted one total and
// billed another. You do not have to remember that: "the two implementations
// agree" at the bottom of this file fails the moment they diverge.
describe("passOnBreakdown", () => {
  it("grosses up so the organizer receives the full base", () => {
    // ₱2,000 base, RP 3% = ₱60, GCash 1.5%.
    const b = passOnBreakdown(200000, 6000, GCASH);
    // The processor line is ₱31.38, not the ₱31.37 GCash will actually take.
    // It is DERIVED (total - base - platformFee) so the three lines always sum
    // to the charge — PayMongo computes the amount FROM the line items, so a
    // line that summed to ₱2,091.37 against a ₱2,091.38 charge is not a display
    // nit, it is a different charge. The ₱0.01 gap is grossUpCharge's ceil, and
    // it is not lost: it survives the processor's cut and lands in the
    // organizer's net (₱2,000.01), which is the side the ceil deliberately
    // favours — never a shortfall.
    expect(b).toEqual({ base: 200000, platformFee: 6000, processorFee: 3138, total: 209138 });
    expect(predictProcessorFee(b.total, GCASH)).toBe(3137);
    // What survives covers base + commission.
    expect(b.total - b.processorFee).toBeGreaterThanOrEqual(206000);
  });

  it("covers the fixed component on a card", () => {
    const b = passOnBreakdown(200000, 6000, CARD);
    expect(b).toEqual({ base: 200000, platformFee: 6000, processorFee: 9026, total: 215026 });
    expect(b.total - b.processorFee).toBe(206000);
  });

  it("keeps the lines summing to the total for every rate", () => {
    for (const rate of [CARD, GCASH, INTL]) {
      const b = passOnBreakdown(200000, 6000, rate);
      expect(b.base + b.platformFee + b.processorFee).toBe(b.total);
    }
  });

  /** The money-critical property, stated over the ACTUAL cut rather than the
   *  derived line: whatever the processor really takes, base + commission must
   *  still survive it. A pass-on mode that under-collects is worse than no
   *  pass-on mode at all — the organizer is short and nothing flags it. */
  it("never under-collects, for any rate or any base", () => {
    for (const rate of [CARD, GCASH, INTL, { percent_bps: 80, fixed_cents: 0 }]) {
      for (const base of [1000, 33333, 99999, 200000, 1000000]) {
        for (const platformFee of [0, 3000, Math.round(base * 0.03)]) {
          const b = passOnBreakdown(base, platformFee, rate);
          const survives = b.total - predictProcessorFee(b.total, rate);
          expect(survives).toBeGreaterThanOrEqual(base + platformFee);
          expect(survives).toBeLessThanOrEqual(base + platformFee + 1);
        }
      }
    }
  });

  it("charges nothing for a free entry", () => {
    expect(passOnBreakdown(0, 0, CARD)).toEqual({
      base: 0, platformFee: 0, processorFee: 0, total: 0,
    });
  });
});

/**
 * The runner sees `passOnLines`/`feeOn` (apps/site/lib/payment.ts); the server
 * charges `passOnBreakdown`/`computeFee`. The site copies exist because
 * apps/site is Node and cannot import a Deno module — but "documented as a
 * duplicate" is not a guarantee, and two suites each asserting their OWN copy
 * against literals catches drift only if whoever edits one happens to run the
 * other. The realistic miss is somebody changing the server formula, updating
 * the test that went red, and never opening apps/site: both suites green, and
 * the pay screen quotes a total nobody will be charged.
 *
 * So the duplication is pinned MECHANICALLY, here. The import goes THIS way for
 * a reason: apps/site/lib/payment.ts imports nothing at all and this config
 * already runs `supabase/**` under node, so pulling it in needs no alias, no
 * tsconfig change and no Deno. The reverse — apps/site importing this Deno
 * module — is what is actually impossible, and is why the duplicate exists.
 *
 * The grid is the same rate/base/commission space the properties above use, so
 * agreement is checked exactly where the behaviour is pinned: every rate shape
 * (percentage-only, percentage + fixed, above and below the seeded card rate),
 * a free entry, a ₱0.01 entry, the rounding-sensitive bases, and both
 * commission shapes including one large enough to trip computeFee's clamp.
 */
describe("the two implementations agree", () => {
  const RATES = [CARD, GCASH, INTL, { percent_bps: 80, fixed_cents: 0 }];
  const BASES = [0, 1, 1000, 6000, 33333, 99999, 200000, 1000000];

  it("passOnLines (apps/site) === passOnBreakdown (_shared), for every rate and base", () => {
    for (const rate of RATES) {
      for (const base of BASES) {
        // Including a commission on a ₱0 base: the amount to gross up is
        // base + commission, so a copy that guarded on the base alone would
        // show zeros here while this one charges.
        for (const platformFee of [0, 1, 3000, 7500, Math.round(base * 0.03)]) {
          expect(passOnLines(base, platformFee, rate)).toEqual(
            passOnBreakdown(base, platformFee, rate),
          );
        }
      }
    }
  });

  it("both refuse an unchargeable rate rather than inverting", () => {
    for (const bps of [10000, 12000]) {
      const rate = { percent_bps: bps, fixed_cents: 0 };
      expect(() => passOnLines(200000, 6000, rate)).toThrow();
      expect(() => passOnBreakdown(200000, 6000, rate)).toThrow();
    }
  });

  it("feeOn (apps/site) === computeFee (_shared), for every terms shape", () => {
    const TERMS = [
      { commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0 },
      { commission_type: "percent", commission_rate: 0.10, commission_flat_cents: 0 },
      { commission_type: "percent", commission_rate: 0.075, commission_flat_cents: 0 },
      // A rate above 100% and a null rate: both hit branches (the clamp, the
      // 10% default) a port is likeliest to drop.
      { commission_type: "percent", commission_rate: 1.5, commission_flat_cents: 0 },
      { commission_type: "percent", commission_rate: null, commission_flat_cents: 0 },
      { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 },
      { commission_type: "fixed", commission_rate: null, commission_flat_cents: 0 },
      // A flat fee larger than the entry, which computeFee clamps.
      { commission_type: "fixed", commission_rate: null, commission_flat_cents: 500000 },
    ];
    for (const total of BASES) {
      for (const terms of TERMS) {
        expect(feeOn(total, terms)).toBe(computeFee(total, terms));
      }
    }
  });

  /** And end to end: the runner's whole quoted total, struck from the org's
   *  terms and grossed up for the method, is the number payment-session
   *  computes from the same two inputs. */
  it("quotes the same total the server will charge, terms and rate together", () => {
    for (const rate of RATES) {
      for (const base of BASES) {
        for (const terms of [
          { commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0 },
          { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 },
        ]) {
          expect(passOnLines(base, feeOn(base, terms), rate).total).toBe(
            passOnBreakdown(base, computeFee(base, terms), rate).total,
          );
        }
      }
    }
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
