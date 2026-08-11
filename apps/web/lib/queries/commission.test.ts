import { describe, it, expect } from "vitest";
import {
  rateToPercent,
  percentToRate,
  describeRefund,
  feeOn,
  describeFeeEquivalent,
  flatFeeWarning,
  zeroFeeWarning,
  zeroRetentionWarning,
  nonRetroactiveNotice,
  describeChargedFee,
  describeRateDrift,
  type RateDrift,
} from "./commission";

describe("rate conversion", () => {
  it("shows a stored fraction as a percentage", () => {
    expect(rateToPercent(0.10)).toBe(10);
    expect(rateToPercent(0.085)).toBe(8.5);
  });

  it("stores a typed percentage as a fraction", () => {
    // The DB must never see 10 meaning 10% — that would be a 1000% fee.
    expect(percentToRate(10)).toBe(0.1);
    expect(percentToRate(8.5)).toBe(0.085);
  });

  it("round-trips without drift", () => {
    for (const p of [0, 2.5, 8.5, 10, 12.75, 100]) {
      expect(rateToPercent(percentToRate(p))).toBeCloseTo(p, 6);
    }
  });
});

describe("describeRefund", () => {
  it("spells out a flat-fee split in pesos", () => {
    expect(describeRefund({
      refund_policy: "flat_fee", refund_fee_cents: 30000,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 200000)).toBe("Gets ₱1,700.00 back. Of the ₱300.00 retained, ₱30.00 is commission and ₱270.00 goes to the organizer.");
  });

  it("says nobody keeps anything on a full refund", () => {
    expect(describeRefund({
      refund_policy: "full", refund_fee_cents: 0,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 150000)).toBe("Gets all ₱1,500.00 back. Neither the organizer nor Race Pace keeps anything.");
  });

  it("says refunds are refused under 'none'", () => {
    expect(describeRefund({
      refund_policy: "none", refund_fee_cents: 0,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 150000)).toBe("Refunds are not offered. The entry stands as a paid sale.");
  });

  it("clamps a retention larger than the entry — the runner gets nothing back, never negative", () => {
    expect(describeRefund({
      refund_policy: "flat_fee", refund_fee_cents: 300000,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 200000)).toBe("Gets ₱0.00 back. Of the ₱2,000.00 retained, ₱200.00 is commission and ₱1,800.00 goes to the organizer.");
  });

  it("strikes a FLAT commission against the retained amount, clamped to it", () => {
    // ₱300 retained, ₱75 flat fee -> ₱75 commission, ₱225 to the organizer.
    expect(describeRefund({
      refund_policy: "flat_fee", refund_fee_cents: 30000,
      commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500,
    }, 200000)).toBe("Gets ₱1,700.00 back. Of the ₱300.00 retained, ₱75.00 is commission and ₱225.00 goes to the organizer.");
  });
});

describe("feeOn — must agree with supabase/functions/_shared/fee.ts#computeFee", () => {
  const percent = { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0 };
  const flat = { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 };

  it("takes a percentage of the total", () => {
    expect(feeOn(200000, percent)).toBe(20000);
  });

  it("defaults a null rate to 10%, exactly as computeFee does", () => {
    expect(feeOn(200000, { commission_type: "percent", commission_rate: null, commission_flat_cents: 0 })).toBe(20000);
  });

  it("clamps a flat fee to the entry total — net_to_org must never go negative", () => {
    expect(feeOn(6000, flat)).toBe(6000);
  });

  it("is zero on a zero or negative total", () => {
    expect(feeOn(0, flat)).toBe(0);
    expect(feeOn(-1, percent)).toBe(0);
  });
});

describe("describeFeeEquivalent — the other form of the same fee", () => {
  it("shows a percentage as pesos on the average entry", () => {
    expect(describeFeeEquivalent(
      { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0 },
      110000,
    )).toBe("≈ ₱110 on a ₱1,100 average entry");
  });

  it("shows a flat fee as a percentage of the average entry", () => {
    expect(describeFeeEquivalent(
      { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 },
      109400,
    )).toBe("≈ 6.9% of a ₱1,094 average entry");
  });

  it("says so rather than dividing by zero when the org has no paid entries yet", () => {
    expect(describeFeeEquivalent(
      { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 },
      0,
    )).toBe("No paid entries yet to compare against");
  });
});

describe("flatFeeWarning — a silent clamp is worse than a visible one", () => {
  const flat75 = { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 };

  it("names the category a flat fee would swallow whole", () => {
    expect(flatFeeWarning(flat75, { label: "Pulangi 5K", base_price: 6000 }, "RunWithPoint")).toBe(
      "RunWithPoint's cheapest open category is the Pulangi 5K at ₱60. A ₱75 flat fee exceeds it, so that entry earns the organizer nothing — the fee is clamped to the entry total so net_to_org never goes negative.",
    );
  });

  it("is silent when the flat fee is below the cheapest entry", () => {
    expect(flatFeeWarning(flat75, { label: "Pulangi 5K", base_price: 90000 }, "RunWithPoint")).toBeNull();
  });

  it("is silent for a percentage fee — a percentage can never exceed the entry", () => {
    expect(flatFeeWarning(
      { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0 },
      { label: "Pulangi 5K", base_price: 6000 },
      "RunWithPoint",
    )).toBeNull();
  });

  it("is silent when the org has no open categories to compare against", () => {
    expect(flatFeeWarning(flat75, null, "RunWithPoint")).toBeNull();
  });
});

describe("₱0 is never what anyone means", () => {
  it("flags a ₱0 flat commission", () => {
    expect(zeroFeeWarning({
      commission_type: "fixed", commission_rate: null, commission_flat_cents: 0,
    })).toBe("A ₱0 flat commission earns Race Pace nothing on every entry.");
  });

  it("flags a ₱0 flat-fee retention as indistinguishable from a full refund", () => {
    expect(zeroRetentionWarning("flat_fee", 0)).toBe("A ₱0 retention is indistinguishable from a full refund.");
  });

  it("says nothing about a ₱0 flat amount an org is not actually on", () => {
    expect(zeroFeeWarning({
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    })).toBeNull();
    expect(zeroRetentionWarning("full", 0)).toBeNull();
    expect(zeroRetentionWarning("none", 0)).toBeNull();
  });
});

describe("nonRetroactiveNotice — the whole reason this page has an amber strip", () => {
  it("names the org, the pending change and the payments it does not touch", () => {
    expect(nonRetroactiveNotice(
      "RunWithPoint",
      { commission_type: "fixed", commission_rate: 0.1, commission_flat_cents: 7500 },
      { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0 },
      702,
    )).toBe("Switching RunWithPoint to a flat ₱75 per registration affects entries paid from now on. Their 702 existing payments keep the 10.0% they were charged at.");
  });

  it("reads the other way round when moving to a percentage", () => {
    expect(nonRetroactiveNotice(
      "Muspo",
      { commission_type: "percent", commission_rate: 0.085, commission_flat_cents: 7500 },
      { commission_type: "fixed", commission_rate: 0.1, commission_flat_cents: 7500 },
      1284,
    )).toBe("Switching Muspo to 8.5% per registration affects entries paid from now on. Their 1,284 existing payments keep the ₱75 flat they were charged at.");
  });

  it("still says it when nothing is being changed — a rate change is never retroactive, pending or not", () => {
    const terms = { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0 };
    expect(nonRetroactiveNotice("Muspo", terms, terms, 0)).toBe(
      "Changing Muspo's commission affects entries paid from now on. Their existing payments keep the 10.0% they were charged at.",
    );
    expect(nonRetroactiveNotice("Muspo", terms, terms, 1284)).toBe(
      "Changing Muspo's commission affects entries paid from now on. Their 1,284 existing payments keep the 10.0% they were charged at.",
    );
  });

  it("ignores a stale flat amount sitting behind a percentage fee — only the ACTIVE half is a change", () => {
    const saved = { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 7500 };
    const pending = { commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 9900 };
    expect(nonRetroactiveNotice("Muspo", pending, saved, 5)).toContain("Changing Muspo's commission");
  });
});

describe("describeChargedFee — read off the payments, never off today's terms", () => {
  it("reports a constant peso fee across differing entry prices as flat", () => {
    expect(describeChargedFee([
      { amount: 150000, platform_fee: 7500 },
      { amount: 200000, platform_fee: 7500 },
    ])).toBe("₱75 flat each");
  });

  it("reports a constant ratio as a percentage", () => {
    expect(describeChargedFee([
      { amount: 150000, platform_fee: 15000 },
      { amount: 200000, platform_fee: 20000 },
    ])).toBe("10.0% each");
  });

  it("reports an event that straddled a terms change as blended", () => {
    expect(describeChargedFee([
      { amount: 200000, platform_fee: 20000 },
      { amount: 200000, platform_fee: 7500 },
    ])).toBe("blended 6.9%");
  });

  it("has nothing to report on an event with no paid entries", () => {
    expect(describeChargedFee([])).toBe("—");
  });
});

/* ------------------------------------------------------------------ *
 * Rate drift
 * ------------------------------------------------------------------ */

/** The shape processor_rate_drift_v emits for a flagged method: 18 of the last
 *  20 card payments implied 4.50% against a carded 3.50%, ₱1,000 under-collected
 *  across them. */
const CARD_DRIFT: RateDrift = {
  method: "card", scope: "local",
  sample_size: 20, disagreeing: 18,
  median_implied_bps: 450, card_bps: 350,
  delta_cents: 100000, drifting: true,
};

describe("describeRateDrift", () => {
  it("reports what was observed without asserting that the rate changed", () => {
    const n = describeRateDrift(CARD_DRIFT, "Card");

    // The whole point of this copy. The view derives `scope` as a hardcoded
    // 'local' literal because `payments` has no scope discriminator, so a
    // genuinely international card (carded at 450 bps) lands in this very sample
    // and reads as drift against the 350 bps local rate. A platform with steady
    // overseas volume could sit flagged forever with nothing having changed.
    // Anything that declares a repricing here is a banner that is sometimes
    // false — and one an operator learns to dismiss on the run where it is true.
    const all = Object.values(n).join(" ");
    expect(all).not.toMatch(/rate has changed|has been repriced|provider (has )?raised/i);
    expect(n.headline).toBe("Card payments are costing more than the rate card predicts.");
    // "18 OF THE LAST 20", not "the last 18 of 20". `disagreeing` is
    // greatest(over, under) WITHIN the sample, not its most recent slice — the
    // recency phrasing made a claim about rows the view never identified.
    expect(n.observation).toBe(
      "18 of the last 20 Card payments came in higher than predicted; " +
      "the median across the sample implied 4.50%, against the local rate card's 3.50%.",
    );
  });

  it("names the explanation the sample cannot rule out, and asks for a check", () => {
    const n = describeRateDrift(CARD_DRIFT, "Card");
    expect(n.caveat).toMatch(/does not on its own mean the provider repriced/i);
    expect(n.caveat).toMatch(/no local\/international marker/i);
    expect(n.action).toMatch(/before editing the rate card/i);
  });

  it("says who is out of pocket, and that nothing downstream is wrong", () => {
    const n = describeRateDrift(CARD_DRIFT, "Card");
    // Positive delta = the provider took MORE than predicted, so the pass-on
    // surcharge under-collected and Race Pace ate the difference.
    expect(n.money).toContain("under-collected ₱1,000");
    expect(n.money).toMatch(/Organizers were paid in full/);
    expect(n.money).toMatch(/no report is wrong/);
  });

  it("flips direction on an over-collection instead of printing a negative", () => {
    const n = describeRateDrift({ ...CARD_DRIFT, delta_cents: -100000, median_implied_bps: 250 }, "Card");
    expect(n.headline).toContain("costing less");
    expect(n.money).toContain("over-collected ₱1,000");
    expect(n.money).not.toContain("-₱");
  });

  it("takes its direction from the RATES, so a sample that nets to zero still reads right", () => {
    // 16 payments ₱2 over and 4 payments ₱8 under: `drifting` fires (16 of 20 in
    // the dominant direction, over the 80% floor) while delta_cents sums to
    // EXACTLY ZERO. Reading the sign of the money gave "costing less … Race Pace
    // over-collected ₱0" — wrong direction and a meaningless amount, in one
    // sentence. The rate comparison still points the right way.
    const n = describeRateDrift({ ...CARD_DRIFT, disagreeing: 16, delta_cents: 0 }, "Card");
    expect(n.headline).toBe("Card payments are costing more than the rate card predicts.");
    expect(n.money).not.toContain("₱0");
    expect(n.money).toMatch(/cancelled out across the sample, so nothing was absorbed on balance/);
    expect(n.money).toMatch(/Organizers were paid in full/);
  });

  it("picks no direction at all when neither the rates nor the totals point anywhere", () => {
    // The degenerate flag: the sample disagrees consistently and cancels
    // perfectly, at the same median as the card. Guessing a direction here would
    // be inventing one.
    const n = describeRateDrift({ ...CARD_DRIFT, median_implied_bps: 350, delta_cents: 0 }, "Card");
    expect(n.headline).toBe("Card payments are not matching the rate card, in both directions.");
    expect(n.observation).toContain("came in differently than predicted");
  });

  it("falls back to the raw method when no label is supplied", () => {
    // `payments.method` carries PayMongo's own vocabulary, which this repo does
    // not control — an instrument added upstream must still produce a sentence.
    expect(describeRateDrift({ ...CARD_DRIFT, method: "billease" }).headline)
      .toBe("billease payments are costing more than the rate card predicts.");
  });
});
