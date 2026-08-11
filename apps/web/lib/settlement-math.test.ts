import { describe, it, expect } from "vitest";
import {
  forecastRates,
  projectedRange,
  remainingCapacity,
  settlementTotals,
  soldAverages,
  toSettlementRow,
  toSettlementRows,
  unreconciledCount,
  type ProcessorRateCandidate,
  type RunnerName,
  type SettlementPayment,
} from "./settlement-math";
import type { SettlementRow } from "@/lib/settlement-csv";

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  registration_id: "r", runner_name: "R", category: "40K",
  paid_at: "2026-08-01T02:00:00Z", method: "gcash",
  gross_paid: 200000, rp_commission: 6000, processing_fee: 3000, net_to_org: 191000,
  status: "paid", refunded_amount: 0, refunded_at: null, ...over,
});

describe("settlementTotals", () => {
  it("sums each column independently", () => {
    expect(settlementTotals([row(), row()])).toEqual({
      gross: 400000, commission: 12000, processing: 6000, refunds: 0, net: 382000,
    });
  });

  it("counts a refunded entry's payout as zero but keeps its refund visible", () => {
    const t = settlementTotals([
      row(),
      row({ status: "refunded", refunded_amount: 191000, net_to_org: 191000 }),
    ]);
    // The refunded row contributed nothing to the organizer.
    expect(t.net).toBe(191000);
    expect(t.refunds).toBe(191000);
  });

  it("returns zeroes for an event with no payments", () => {
    expect(settlementTotals([])).toEqual({
      gross: 0, commission: 0, processing: 0, refunds: 0, net: 0,
    });
  });

  /**
   * A refund written at GROSS scale, which is what the organizer is actually
   * looking at on the hosted database.
   *
   * `refunded_amount` on a full refund has had three writers and they disagree:
   * the current refund_registration_tx stores net_to_org (20260811094000), the
   * pre-2026-08-11 body stored the gross `v_amount` (20260808140000), and the
   * demo seeder — the hosted dataset — stores `r.total_amount`. Summing the
   * stored column would put ₱2,000 in the Refunds line against a ₱1,910 refund,
   * and the waterfall would fail to close by exactly the commission plus the
   * processing fee.
   */
  it("sizes a refund from net_to_org, so a legacy gross-scale row still closes", () => {
    const legacy = row({
      status: "refunded", net_to_org: 191000, refunded_amount: 200000, // gross, not net
    });
    const t = settlementTotals([legacy]);
    expect(t.refunds).toBe(191000);
    expect(t.net).toBe(0);
    expect(t.gross - t.commission - t.processing - t.refunds).toBe(t.net);
  });

  it("reads a partial refund from refunded_amount, where net_to_org is the retention", () => {
    // The RPC guarantees the split: refunded_amount + net_to_org = the original
    // net (91000 + 100000 = 191000), enforced as `refund_split_mismatch`. Both
    // figures on this row are true and they mean different things.
    const t = settlementTotals([row({
      status: "partially_refunded", refunded_amount: 91000, net_to_org: 100000,
    })]);
    expect(t.refunds).toBe(91000);
    expect(t.net).toBe(100000);
    expect(t.gross - t.commission - t.processing - t.refunds).toBe(t.net);
  });

  /**
   * The identity the page's headline promises, across every status and fee
   * source at once — the only assertion that would catch a future column being
   * summed from the wrong place.
   */
  it("closes gross − commission − processing − refunds = net on a mixed event", () => {
    const t = settlementTotals([
      row(),                                                                    // paid, actual
      row({ status: "partially_refunded", refunded_amount: 91000, net_to_org: 100000 }),
      row({ status: "refunded", net_to_org: 191000, refunded_amount: 191000 }), // current writer
      row({ status: "refunded", net_to_org: 191000, refunded_amount: 200000 }), // legacy writer
      // 'historical': the platform absorbed the fee, so this row reports zero
      // processing AND its net_to_org deliberately does not deduct one.
      row({ processing_fee: 0, net_to_org: 194000 }),
    ]);
    expect(t).toEqual({
      gross: 1000000, commission: 30000, processing: 12000, refunds: 473000, net: 485000,
    });
    expect(t.gross - t.commission - t.processing - t.refunds).toBe(t.net);
  });

  /**
   * The worked example from the design: one ₱2,000 GCash entry at 3%.
   * RP keeps ₱60, PayMongo keeps ₱30, the organizer keeps ₱1,910 — and the
   * summary has to say exactly that, because it is the row an organizer will
   * hand-check the whole page against.
   */
  it("reports the design's worked ₱2,000 GCash entry unchanged", () => {
    expect(settlementTotals([row()])).toEqual({
      gross: 200000, commission: 6000, processing: 3000, refunds: 0, net: 191000,
    });
  });
});

/**
 * The payment → row mapping, and specifically its `historical` ternary.
 *
 * That one line is the most consequential in the settlement view: it decides
 * whether an organizer is shown a processing cost the PLATFORM paid. It used to
 * live in `lib/queries/settlement.ts`, which imports next/headers through the
 * Supabase server client and therefore cannot be imported by a test at all — its
 * only proof was a throwaway E2E script that was deleted after one run. It is
 * pure arithmetic over a plain object, so it belongs here, where it is held
 * permanently.
 */
describe("toSettlementRow", () => {
  const pay = (over: Partial<SettlementPayment> = {}): SettlementPayment => ({
    registration_id: "reg-1", amount: 200000, platform_fee: 6000,
    processor_fee_cents: 3000, processor_fee_source: "actual", net_to_org: 191000,
    status: "paid", refunded_amount: 0, method: "gcash",
    created_at: "2026-08-01T02:00:00Z",
    registrations: { user_id: "u-1", categories: { label: "40K" } },
    ...over,
  });
  const names = new Map<string, RunnerName>([
    ["u-1", { full_name: "Ana Reyes", bib_name: "ANA" }],
  ]);

  it("maps a paid entry to exactly the figures the summary sums", () => {
    expect(toSettlementRow(pay(), names)).toEqual({
      registration_id: "reg-1", runner_name: "Ana Reyes", category: "40K",
      paid_at: "2026-08-01T02:00:00Z", method: "gcash",
      gross_paid: 200000, rp_commission: 6000, processing_fee: 3000, net_to_org: 191000,
      status: "paid", refunded_amount: 0, refunded_at: null,
    });
  });

  it("reports a 'historical' processing fee as ZERO to the organizer", () => {
    // The platform absorbed this fee under pre-2026-08-11 terms. The ledger
    // stores 3000 and net_to_org (194000) deliberately does NOT deduct it —
    // billing the organizer for it would both overstate their cost and break
    // gross - commission - processing on this row.
    const r = toSettlementRow(
      pay({ processor_fee_source: "historical", processor_fee_cents: 3000, net_to_org: 194000 }),
      names,
    );
    expect(r.processing_fee).toBe(0);
    expect(r.net_to_org).toBe(194000);
  });

  it.each(["actual", "predicted", "none"])(
    "passes a '%s' processing fee through unchanged",
    (source) => {
      expect(toSettlementRow(pay({ processor_fee_source: source }), names).processing_fee)
        .toBe(3000);
    },
  );

  it("falls back through full_name, bib_name, then a placeholder", () => {
    const withNames = new Map<string, RunnerName>([
      ["full", { full_name: "Ana Reyes", bib_name: "ANA" }],
      // Present but useless: `??` would render a blank cell mid-table.
      ["blank", { full_name: "   ", bib_name: "ANA" }],
      ["bib", { full_name: null, bib_name: "ANA" }],
      ["neither", { full_name: null, bib_name: null }],
    ]);
    const nameFor = (userId: string | null) =>
      toSettlementRow(pay({ registrations: { user_id: userId, categories: null } }), withNames)
        .runner_name;

    expect(nameFor("full")).toBe("Ana Reyes");
    expect(nameFor("blank")).toBe("ANA");
    expect(nameFor("bib")).toBe("ANA");
    expect(nameFor("neither")).toBe("Unknown runner");
    // A profile the read could not reach (RLS, or a deleted account).
    expect(nameFor("missing-from-map")).toBe("Unknown runner");
    expect(nameFor(null)).toBe("Unknown runner");
  });

  it("degrades a missing category and a missing join rather than throwing", () => {
    const r = toSettlementRow(pay({ registrations: null }), names);
    expect(r.category).toBe("—");
    expect(r.runner_name).toBe("Unknown runner");
    // Still reports the money, which is what the page is for.
    expect(r.gross_paid).toBe(200000);
  });

  it("maps a list in order", () => {
    const rows = toSettlementRows([pay(), pay({ registration_id: "reg-2" })], names);
    expect(rows.map((r) => r.registration_id)).toEqual(["reg-1", "reg-2"]);
  });
});

/**
 * Which rates a forecast is allowed to rank over.
 *
 * The rate card seeds methods that are not enabled yet, so ranking over all of
 * them put `dob` — 80 bps, and its own seed note says UNCONFIRMED — at the
 * optimistic end of a number an organizer plans around.
 */
describe("forecastRates", () => {
  const card: ProcessorRateCandidate = {
    percent_bps: 350, fixed_cents: 1500, scope: "local", offered: true,
    note: "Quoted 3.125% + ₱13.39 ex-VAT",
  };
  const gcash: ProcessorRateCandidate = {
    percent_bps: 150, fixed_cents: 0, scope: "local", offered: true, note: "Quoted 1.34% ex-VAT",
  };
  const dob: ProcessorRateCandidate = {
    percent_bps: 80, fixed_cents: 0, scope: "local", offered: false,
    note: "Quoted ~0.71% ex-VAT — UNCONFIRMED",
  };
  const intlCard: ProcessorRateCandidate = {
    percent_bps: 450, fixed_cents: 1500, scope: "international", offered: true, note: null,
  };

  it("ignores a method runners cannot choose", () => {
    const r = forecastRates([card, gcash, dob], 200000);
    expect(r).toEqual({
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 350, fixed_cents: 1500 },
    });
  });

  it("ignores an UNCONFIRMED rate even once its method is offered", () => {
    // The second filter is independent of the first on purpose: a note comes off
    // when the figure is confirmed from real settlements, not when the button
    // ships.
    const enabled = { ...dob, offered: true };
    expect(forecastRates([card, gcash, enabled], 200000)?.cheap)
      .toEqual({ percent_bps: 150, fixed_cents: 0 });
  });

  it("ignores another scope", () => {
    expect(forecastRates([card, gcash, intlCard], 200000)?.dear)
      .toEqual({ percent_bps: 350, fixed_cents: 1500 });
  });

  it("returns null when nothing is both offered and confirmed", () => {
    expect(forecastRates([dob], 200000)).toBeNull();
    expect(forecastRates([], 200000)).toBeNull();
  });

  it("ranks at the event's own entry price, not at a notional one", () => {
    // 0 bps + ₱20 against card's 3.5% + ₱15: the flat rate is DEARER on a ₱100
    // entry (2000 vs 1850) and cheaper on a ₱2,000 one (2000 vs 8500) — the
    // order genuinely flips at ₱142.86. Ranking on a notional entry, which is
    // what `percent_bps * 100 + fixed_cents` amounts to, calls the flat rate
    // cheapest at every price and gets the ₱100 fun-run backwards.
    const flat: ProcessorRateCandidate = {
      percent_bps: 0, fixed_cents: 2000, scope: "local", offered: true, note: null,
    };
    expect(forecastRates([card, flat], 10000)?.cheap).toEqual({ percent_bps: 350, fixed_cents: 1500 });
    expect(forecastRates([card, flat], 200000)?.cheap).toEqual({ percent_bps: 0, fixed_cents: 2000 });
  });
});

describe("remainingCapacity", () => {
  it("sums slots across an event's categories", () => {
    expect(remainingCapacity([
      { slots_total: 300, slots_taken: 120 },
      { slots_total: 200, slots_taken: 80 },
    ])).toBe(300);
  });

  it("is zero for a sold-out event, which is a fact", () => {
    expect(remainingCapacity([{ slots_total: 100, slots_taken: 100 }])).toBe(0);
  });

  it("never goes negative when an over-sale slips through", () => {
    expect(remainingCapacity([{ slots_total: 100, slots_taken: 104 }])).toBe(0);
  });

  it("is unknown — not zero — when capacity was never configured", () => {
    // slots_total defaults to 0, so "no capacity set" would otherwise be
    // indistinguishable from "sold out".
    expect(remainingCapacity([{ slots_total: 0, slots_taken: 0 }])).toBeNull();
    expect(remainingCapacity([])).toBeNull();
  });
});

describe("soldAverages", () => {
  it("averages the entries whose money the organizer kept", () => {
    expect(soldAverages([
      row({ gross_paid: 200000, rp_commission: 6000 }),
      row({ gross_paid: 100000, rp_commission: 3000 }),
    ])).toEqual({ avgEntry: 150000, avgCommission: 4500 });
  });

  it("ignores refunded entries, whose commission went back with the refund", () => {
    expect(soldAverages([
      row({ gross_paid: 200000, rp_commission: 6000 }),
      row({ status: "refunded", gross_paid: 20000, rp_commission: 600, refunded_amount: 19100 }),
    ])).toEqual({ avgEntry: 200000, avgCommission: 6000 });
  });

  it("is zero when nothing has sold, which reads downstream as 'no basis'", () => {
    expect(soldAverages([])).toEqual({ avgEntry: 0, avgCommission: 0 });
    expect(soldAverages([row({ status: "refunded" })])).toEqual({ avgEntry: 0, avgCommission: 0 });
  });
});

describe("projectedRange", () => {
  const rates = {
    cheap: { percent_bps: 150, fixed_cents: 0 },
    dear: { percent_bps: 350, fixed_cents: 1500 },
  };

  it("forecasts only the entries not yet sold, and adds the banked net whole", () => {
    // 500 unsold x ₱2,000 at 3% commission: GCash 1.5%, card 3.5% + ₱15.
    // Per entry the organizer nets ₱1,910 (GCash) or ₱1,855 (card).
    // ₱50,000 already banked sits at BOTH ends, unranged.
    const r = projectedRange(5000000, 500, 200000, 6000, rates);
    expect(r).toEqual({ low: 5000000 + 92750000, high: 5000000 + 95500000 });
  });

  it("does not range money already collected", () => {
    // The bug this replaced: a one-entry event printed
    // "Projected net ₱1,855–₱1,924" under a card reading "Net to you ₱1,910",
    // because the band was struck over a runner who had already paid. With
    // nothing left to sell there is nothing to forecast.
    expect(projectedRange(191000, 0, 200000, 6000, rates)).toBeNull();
  });

  it("has no basis to forecast from before the first entry sells", () => {
    expect(projectedRange(0, 500, 0, 0, rates)).toBeNull();
  });

  it("collapses to a point when every offered method costs the same", () => {
    const flat = { cheap: rates.cheap, dear: rates.cheap };
    const r = projectedRange(0, 10, 200000, 6000, flat)!;
    expect(r.low).toBe(r.high);
  });

  /**
   * The specific misquote this pair of functions exists to prevent: ranking over
   * every seeded rate made `dob` the cheapest and put ₱962,000 on an organizer's
   * screen, where ₱955,000 is the best a runner can actually reach.
   */
  it("quotes a high end runners can actually reach", () => {
    const card: ProcessorRateCandidate = {
      percent_bps: 350, fixed_cents: 1500, scope: "local", offered: true, note: null,
    };
    const gcash: ProcessorRateCandidate = {
      percent_bps: 150, fixed_cents: 0, scope: "local", offered: true, note: null,
    };
    const dob: ProcessorRateCandidate = {
      percent_bps: 80, fixed_cents: 0, scope: "local", offered: false, note: "UNCONFIRMED",
    };
    const picked = forecastRates([card, gcash, dob], 200000)!;
    const r = projectedRange(0, 500, 200000, 6000, picked)!;
    expect(r.high).toBe(95500000);
    expect(r.high).not.toBe(96200000);
  });
});

/**
 * The swallow this helper exists to prevent is documented in
 * 20260811095000_payout_open_statement_v2.sql: a caller that reads `{ data }`
 * and coerces with `?? 0` turns a 42501 — or any network failure — into a
 * confident "0 unreconciled", the warning banner never renders, and NO TEST
 * FAILS. These are that missing test.
 */
describe("unreconciledCount", () => {
  it("passes a real count through", () => {
    expect(unreconciledCount({ data: 3, error: null })).toBe(3);
  });

  it("keeps a genuine zero as zero, not as unknown", () => {
    expect(unreconciledCount({ data: 0, error: null })).toBe(0);
  });

  it("reports a refused call as unknown rather than as zero", () => {
    expect(unreconciledCount({ data: null, error: { message: "forbidden" } })).toBeNull();
  });

  it("reports an errored call as unknown even if a payload came back", () => {
    // Never trust a payload that arrived alongside an error.
    expect(unreconciledCount({ data: 0, error: { message: "boom" } })).toBeNull();
  });

  it("reports a missing payload as unknown", () => {
    expect(unreconciledCount({ data: null, error: null })).toBeNull();
  });
});
