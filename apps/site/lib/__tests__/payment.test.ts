import { describe, it, expect } from "vitest";
import { breakdown, PAY_METHODS, RATE_METHOD, passOnLines, feeOn } from "../payment";

const CARD = { percent_bps: 350, fixed_cents: 1500 };
const GCASH = { percent_bps: 150, fixed_cents: 0 };
const INTL = { percent_bps: 450, fixed_cents: 1500 };

describe("breakdown", () => {
  it("splits a total into entry fee and add-ons", () => {
    expect(breakdown(310000, 250000)).toEqual({ entry: 250000, addons: 60000 });
  });

  it("reports zero add-ons when the total equals the base price", () => {
    expect(breakdown(250000, 250000)).toEqual({ entry: 250000, addons: 0 });
  });

  // basePrice is null when the category embed is missing; the whole total is
  // then the entry fee rather than a negative add-on line.
  it("treats the whole total as entry fee when base price is unknown", () => {
    expect(breakdown(250000, null)).toEqual({ entry: 250000, addons: 0 });
  });

  // A category price cut after registration must never render as negative.
  it("never reports a negative add-on total", () => {
    expect(breakdown(200000, 250000).addons).toBe(0);
  });
});

describe("PAY_METHODS", () => {
  it("offers the three methods the payment-session function accepts", () => {
    expect(PAY_METHODS.map((m) => m.key)).toEqual(["card", "gcash", "maya"]);
  });

  // Every offerable method must price, or the pay screen would show a runner a
  // method it cannot quote — and silently fall back to the sticker price in
  // pass-on mode, which is the one number that must never be shown when it is
  // not what will be charged.
  it("has a rate-card method for every method it offers", () => {
    for (const m of PAY_METHODS) expect(RATE_METHOD[m.key]).toBeTruthy();
  });

  // `processor_rates.method` is PayMongo's name, not the site's: Maya is
  // 'paymaya' there, exactly as METHOD_MAP in payment-session/index.ts maps it.
  // Looking the rate up under 'maya' finds no row, and no row means no
  // breakdown.
  it("translates Maya to PayMongo's own name for the rate card", () => {
    expect(RATE_METHOD).toEqual({ card: "card", gcash: "gcash", maya: "paymaya" });
  });
});

/* ------------------------------------------------------------------ *
 * feeOn — the platform's commission
 * ------------------------------------------------------------------ */

const pct = (r: number | null) => ({ commission_type: "percent", commission_rate: r, commission_flat_cents: 0 });
const flat = (c: number) => ({ commission_type: "fixed", commission_rate: null, commission_flat_cents: c });

// CROSS-ASSERTION with supabase/tests/fee.test.ts ("computeFee"): the cases
// below are that suite's, re-run against this port. `feeOn` is display-only, but
// it decides the "Race Pace service fee" LINE, and PayMongo charges the sum of
// the lines — so a port that disagrees with the server is a different charge,
// not a different label. If one moves, move both.
describe("feeOn", () => {
  it("takes a percentage of the entry", () => {
    expect(feeOn(200000, pct(0.10))).toBe(20000);
  });

  it("rounds a percentage to whole centavos", () => {
    expect(feeOn(33333, pct(0.10))).toBe(3333);
  });

  it("takes a flat amount regardless of entry price", () => {
    expect(feeOn(200000, flat(7500))).toBe(7500);
    expect(feeOn(150000, flat(7500))).toBe(7500);
  });

  // A ₱75 flat fee on a ₱60 entry would otherwise show a NEGATIVE processing
  // line to make the arithmetic close, having already charged the runner for a
  // commission larger than the race.
  it("CLAMPS a flat fee that exceeds the entry", () => {
    expect(feeOn(6000, flat(7500))).toBe(6000);
  });

  it("clamps a mis-entered rate above 100% too", () => {
    expect(feeOn(200000, pct(1.5))).toBe(200000);
  });

  it("charges nothing on a zero-value entry", () => {
    expect(feeOn(0, flat(7500))).toBe(0);
    expect(feeOn(0, pct(0.10))).toBe(0);
  });

  // The default the server uses when a percent org has no rate. It is 10%, not
  // the 3% the column now defaults to — matching `computeFee` matters more than
  // matching the column, because computeFee is what will actually be charged.
  it("falls back to 10% when a percent org has no rate", () => {
    expect(feeOn(200000, pct(null))).toBe(20000);
  });

  // THE REASON ALL THREE TERMS COLUMNS ARE FETCHED, not just fee_mode. A 'fixed'
  // org read as a percent org would fall to that 10% default and surcharge the
  // runner ₱200 instead of the org's ₱75 — silently, and on every entry.
  it("does NOT charge a fixed-terms org the percent default", () => {
    expect(feeOn(200000, flat(7500))).not.toBe(20000);
  });
});

/* ------------------------------------------------------------------ *
 * passOnLines — the itemised charge
 * ------------------------------------------------------------------ */

/** What the processor actually takes out of a charge — the mirror of
 *  `predictProcessorFee` in supabase/functions/_shared/processorFee.ts, kept in
 *  the test rather than the library because nothing on this screen needs to
 *  predict a fee, only to gross one up. It is here so the properties below can
 *  be stated over the REAL cut instead of over the derived line. */
const takes = (amount: number, rate: { percent_bps: number; fixed_cents: number }) =>
  amount <= 0 ? 0 : Math.round((amount * rate.percent_bps) / 10000) + rate.fixed_cents;

// CROSS-ASSERTION with supabase/tests/processor-fee.test.ts ("passOnBreakdown").
// `passOnLines` is a deliberate duplicate of `passOnBreakdown` in
// supabase/functions/_shared/processorFee.ts — apps/site cannot import Deno —
// so the two suites assert the SAME worked examples on purpose. If a number
// below changes, the server copy and its test have to change with it, and vice
// versa: the runner would otherwise be shown one total and charged another.
describe("passOnLines", () => {
  it("matches the server's gross-up for GCash", () => {
    // ₱2,000 base, RP 3% = ₱60, GCash 1.5%.
    expect(passOnLines(200000, 6000, GCASH)).toEqual({
      base: 200000, platformFee: 6000, processorFee: 3138, total: 209138,
    });
  });

  it("matches the server's gross-up for a local card", () => {
    expect(passOnLines(200000, 6000, CARD)).toEqual({
      base: 200000, platformFee: 6000, processorFee: 9026, total: 215026,
    });
  });

  // Naive addition (base + fee + 3.5% of base) charges ₱2,147.10 and lands
  // ₱3.16 short of the organizer's ₱2,060, forever, silently.
  it("grosses up rather than adding — the processor's cut is on the FINAL amount", () => {
    expect(passOnLines(200000, 6000, CARD).total).toBeGreaterThan(200000 + 6000 + 8500);
  });

  it("keeps the three lines summing to the total", () => {
    for (const rate of [CARD, GCASH, INTL]) {
      const l = passOnLines(200000, 6000, rate);
      expect(l.base + l.platformFee + l.processorFee).toBe(l.total);
    }
  });

  /** The money-critical property, stated over the ACTUAL cut rather than the
   *  derived line: whatever the processor really takes, the organizer's base
   *  plus the platform's commission must still survive it. */
  it("never under-collects, for any rate or any base", () => {
    for (const rate of [CARD, GCASH, INTL, { percent_bps: 80, fixed_cents: 0 }]) {
      for (const base of [1000, 33333, 99999, 200000, 1000000]) {
        for (const platformFee of [0, 3000, Math.round(base * 0.03)]) {
          const l = passOnLines(base, platformFee, rate);
          const survives = l.total - takes(l.total, rate);
          expect(survives).toBeGreaterThanOrEqual(base + platformFee);
          // The ceil's remainder, at most ₱0.01, and on the organizer's side.
          expect(survives).toBeLessThanOrEqual(base + platformFee + 1);
        }
      }
    }
  });

  it("returns a zero total for a zero base", () => {
    expect(passOnLines(0, 0, CARD)).toEqual({
      base: 0, platformFee: 0, processorFee: 0, total: 0,
    });
  });

  // A rate at or above 100% inverts the gross-up: at exactly 100% it divides by
  // zero, above it the "total" comes out negative. Neither is a number to put
  // in front of a runner, so this refuses instead — the screen then shows no
  // breakdown at all, which is the honest outcome for an unpriceable method.
  it("throws rather than inverting when a rate is 100% or more", () => {
    expect(() => passOnLines(200000, 6000, { percent_bps: 10000, fixed_cents: 0 })).toThrow();
    expect(() => passOnLines(200000, 6000, { percent_bps: 12000, fixed_cents: 0 })).toThrow();
  });
});
