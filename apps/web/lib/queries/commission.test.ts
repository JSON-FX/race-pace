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

/**
 * The copy a super admin sets commercial policy from, pinned to the rule the
 * SERVER actually applies.
 *
 * Every assertion below was inverted on 2026-08-11 rather than deleted, because
 * each one used to pin the SUPERSEDED rule and the wrong number is the thing
 * worth remembering. Before: the runner got `entry - retained` back, the
 * retention was "a smaller sale" with a second commission struck against it, and
 * a `full` policy handed back the whole entry with nobody keeping anything.
 * Now — `20260811094000_refund_net_to_org.sql` and `_shared/refund.ts:54-60` —
 * the runner is refunded exactly `net_to_org`, Race Pace keeps its commission
 * and the processor keeps its fee, and a flat-fee retention is the organizer's
 * entirely.
 *
 * THE 3% ORG'S ₱2,000 GCASH ENTRY runs through most of them, because it is the
 * example the whole design is written around: commission ₱60, processor ₱30,
 * net_to_org ₱1,910. A ₱300 retention therefore returns ₱1,610 — the page used
 * to say ₱1,700, and to give the organizer ₱291 of a ₱300 that is wholly theirs.
 */
describe("describeRefund", () => {
  /** 3% commission, the terms every worked example on the design is written for. */
  const three = { commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0 };

  it("refunds net_to_org less the retention, and gives the organizer the WHOLE retention", () => {
    expect(describeRefund(
      { refund_policy: "flat_fee", refund_fee_cents: 30000, ...three },
      200000,
      3000,
    )).toBe(
      "Gets ₱1,610.00 back. The organizer keeps the ₱300.00 retained in full — no commission is struck on it. " +
      "Race Pace keeps its ₱60.00 commission and the processor keeps ₱30.00; neither comes back on a refund.",
    );
  });

  it("does NOT return the whole entry on a full refund — the commission and the processor's fee stay put", () => {
    // The single most consequential line on this page. "Gets all ₱2,000.00 back.
    // Neither the organizer nor Race Pace keeps anything." was true of the
    // 2026-08-06 rule and of nothing since; an operator agreeing a full-refund
    // policy on the strength of it is agreeing to something the server will not do.
    const s = describeRefund({ refund_policy: "full", refund_fee_cents: 0, ...three }, 200000, 3000);
    expect(s).toBe(
      "Gets ₱1,910.00 back — the whole of what the organizer would have been paid. " +
      "Race Pace keeps its ₱60.00 commission and the processor keeps ₱30.00; neither comes back on a refund.",
    );
    expect(s).not.toMatch(/all ₱2,000|Neither the organizer nor Race Pace keeps anything/);
  });

  it("never re-strikes commission on the retention, under a percentage or a flat fee", () => {
    // `refund_registration_tx` DROPPED p_retained_fee so that a caller doing this
    // fails loudly. The page must not do in prose what the RPC refuses to do in
    // SQL: on a ₱75-flat org the retention is still ₱300 to the organizer, not
    // ₱225 with ₱75 to Race Pace.
    const flat = describeRefund(
      {
        refund_policy: "flat_fee", refund_fee_cents: 30000,
        commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500,
      },
      200000,
      3000,
    );
    expect(flat).toContain("The organizer keeps the ₱300.00 retained in full");
    expect(flat).toContain("no commission is struck on it");
    // The commission quoted is the ₱75 struck on the ENTRY at capture, and the
    // refund is net of it: net_to_org 200000 - 7500 - 3000 = 189500, less the
    // ₱300 retained = ₱1,595.
    expect(flat).toContain("Gets ₱1,595.00 back");
    expect(flat).toContain("Race Pace keeps its ₱75.00 commission");
  });

  it("says refunds are refused under 'none', with or without a processor figure", () => {
    const none = { refund_policy: "none", refund_fee_cents: 0, ...three };
    expect(describeRefund(none, 150000, 3000)).toBe("Refunds are not offered. The entry stands as a paid sale.");
    expect(describeRefund(none, 150000, null)).toBe("Refunds are not offered. The entry stands as a paid sale.");
  });

  it("clamps a retention larger than net_to_org — to NET, not to the entry — and says so", () => {
    // _shared/refund.ts clamps to `pay.net_to_org`: an organizer cannot retain
    // money they were never going to receive. Clamping to the entry (as this used
    // to) would quote a ₱2,000 retention on an entry that only ever yielded
    // ₱1,910, i.e. ₱90 of Race Pace's and PayMongo's money.
    expect(describeRefund(
      { refund_policy: "flat_fee", refund_fee_cents: 300000, ...three },
      200000,
      3000,
    )).toBe(
      "Gets ₱0.00 back. The ₱3,000.00 retention is more than the ₱1,910.00 the organizer would have been paid, " +
      "so the organizer keeps that whole ₱1,910.00 and nothing goes back. " +
      "Race Pace keeps its ₱60.00 commission and the processor keeps ₱30.00; neither comes back on a refund.",
    );
  });

  it("states the rule and names the missing term when no processor fee was observed", () => {
    // A brand-new org, or one whose payments all predate the three-party ledger
    // ('historical': the platform absorbed the fee, so net_to_org has no
    // processor deduction). There is no honest peso figure to print, and
    // printing ₱0.00 would be a claim, not a gap.
    const s = describeRefund({ refund_policy: "flat_fee", refund_fee_cents: 30000, ...three }, 200000, null);
    expect(s).toBe(
      "Gets back the ₱2,000.00 entry less Race Pace's commission, the processor's fee, and the ₱300.00 " +
      "the organizer retains in full — no commission is struck on a retention. " +
      "Race Pace keeps its ₱60.00 commission and the processor keeps its fee; neither comes back on a refund. " +
      "No payment of theirs records a processor fee — either none has been processed yet, or they predate " +
      "the three-party ledger and Race Pace absorbed the processing — so the exact figures cannot be shown here.",
    );
    // Never a fabricated zero, and never a refund total it cannot compute.
    expect(s).not.toContain("₱0.00");
    expect(s).not.toMatch(/^Gets ₱/);
  });

  it("says the same about a full refund it cannot price", () => {
    expect(describeRefund({ refund_policy: "full", refund_fee_cents: 0, ...three }, 200000, null)).toBe(
      "Gets back the ₱2,000.00 entry less Race Pace's commission and the processor's fee — the whole of " +
      "what the organizer would have been paid. " +
      "Race Pace keeps its ₱60.00 commission and the processor keeps its fee; neither comes back on a refund. " +
      "No payment of theirs records a processor fee — either none has been processed yet, or they predate " +
      "the three-party ledger and Race Pace absorbed the processing — so the exact figures cannot be shown here.",
    );
  });

  it("floors net_to_org at zero rather than quoting a negative refund", () => {
    // A ₱60 entry against a ₱75 flat commission: `feeOn` clamps the fee to the
    // entry, leaving nothing, and the processor's fee cannot push the runner's
    // refund below zero either.
    expect(describeRefund(
      {
        refund_policy: "full", refund_fee_cents: 0,
        commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500,
      },
      6000,
      2000,
    )).toBe(
      "Gets ₱0.00 back — the whole of what the organizer would have been paid. " +
      "Race Pace keeps its ₱60.00 commission and the processor keeps ₱20.00; neither comes back on a refund.",
    );
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
