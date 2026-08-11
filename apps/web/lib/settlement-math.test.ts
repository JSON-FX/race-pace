import { describe, it, expect } from "vitest";
import { projectedRange, settlementTotals, unreconciledCount } from "./settlement-math";
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

describe("projectedRange", () => {
  it("spans cheapest to dearest payment method", () => {
    // 500 x ₱2,000 at 3% commission: GCash 1.5%, card 3.5% + ₱15.
    const r = projectedRange(500, 200000, 6000, {
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 350, fixed_cents: 1500 },
    });
    expect(r).toEqual({ low: 92750000, high: 95500000 });
  });

  it("collapses to a point when both rates are the same", () => {
    const r = projectedRange(10, 200000, 6000, {
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 150, fixed_cents: 0 },
    });
    expect(r.low).toBe(r.high);
  });

  it("is zero for an event with no paid entries", () => {
    const r = projectedRange(0, 200000, 6000, {
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 350, fixed_cents: 1500 },
    });
    expect(r).toEqual({ low: 0, high: 0 });
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
