import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The mapping layer of `getCommissionOverview`, pinned the same way
 * `payments-aggregates.test.ts` pins `getPaymentAggregates`: mock
 * `@/lib/supabase/server` and assert what the reader DERIVES from a known row,
 * not what Postgres returns.
 *
 * These derivations had no coverage at all — `commission.test.ts` exercises the
 * pure helpers and `page.test.tsx` mocks this function wholesale — while being
 * exactly where the three-party ledger's reporting bugs live: reading the column
 * that records the money, and keeping "charged" apart from "retained".
 */
let byTable: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      // Every chained method this query uses. They are pass-throughs: the point
      // of these tests is the arithmetic after the rows arrive, and the filters
      // themselves are enforced (and tested) in Postgres.
      ["select", "order", "in", "is", "eq"].forEach((m) => { builder[m] = () => builder; });
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: byTable[table] ?? [], error: null });
      return builder;
    },
  }),
}));

import { getCommissionOverview } from "./commission";

const ORG = "org-1";
const EV = "ev-1";

/** The canonical ₱2,000 GCash entry at 3%: Race Pace ₱60, PayMongo ₱30, organizer ₱1,910. */
const PAID = { org_id: ORG, event_id: EV, event_name: "Trail 40", amount: 200000, platform_fee: 6000, status: "paid", refunded_amount: 0 };
/** Same entry, partially refunded to a ₱300 retention: ₱1,610 went back. */
const PARTIAL = { ...PAID, status: "partially_refunded", refunded_amount: 161000 };
/** Same entry, fully refunded: a refund returns net_to_org (₱1,910), NOT the ₱2,000 charge. */
const REFUNDED = { ...PAID, status: "refunded", refunded_amount: 191000 };

beforeEach(() => {
  byTable = {
    organizations: [{
      id: ORG, name: "RunWithPoint", created_at: null,
      commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0,
      refund_policy: "flat_fee", refund_fee_cents: 30000,
    }],
    // One plain paid entry + one partially refunded one, as admin_org_totals_v
    // reports them after 20260811095500: charged 2 x ₱2,000; retained ₱2,000 +
    // (₱2,000 - ₱1,610) = ₱2,390.
    admin_org_totals_v: [{
      org_id: ORG, paid_count: 2, gross_revenue: 239000, charged_gross: 400000,
      platform_fee: 12000, net_to_org: 221000,
    }],
    events: [{ id: EV, name: "Trail 40", org_id: ORG, status: "draft" }],
    admin_payments_v: [PAID, PARTIAL, REFUNDED],
    payments: [{ net_to_org: 221000 }],
    categories: [],
  };
});

describe("getCommissionOverview — charged vs retained", () => {
  it("takes the average entry from charged_gross, so it quotes a price somebody paid", async () => {
    const { orgs } = await getCommissionOverview();

    // 400000 / 2 = ₱2,000 — the entry price. From gross_revenue it would be
    // 239000 / 2 = ₱1,195, a fee no runner was ever charged, printed under the
    // label "average entry" and inside "A runner cancelling a ₱X entry".
    expect(orgs[0].avg_entry_cents).toBe(200000);
    expect(orgs[0].avg_entry_cents).not.toBe(Math.round(239000 / 2));
    // The refund worked example is rendered from the same figure.
    expect(orgs[0].example_entry_cents).toBe(200000);
  });

  it("carries charged_gross and gross_revenue as SEPARATE figures on the row", async () => {
    const { orgs } = await getCommissionOverview();

    // GMV column vs "revenue retained". Collapsing them is the whole defect.
    expect(orgs[0].charged_gross).toBe(400000);
    expect(orgs[0].gross_revenue).toBe(239000);
  });

  it("gives the effective rate a charged denominator — a 3% org must not read 5%", async () => {
    const { totals } = await getCommissionOverview();

    // commission / charged_gross is the division the Commission page performs
    // (app/(admin)/commission/page.tsx). Against retained revenue the same org
    // prints 5.0%, and with a deeper refund it prints 15.4% — on the page an
    // operator negotiates rates from.
    expect(totals.charged_gross).toBe(400000);
    expect((totals.commission / totals.charged_gross) * 100).toBeCloseTo(3.0, 6);
    expect((totals.commission / totals.gross) * 100).not.toBeCloseTo(3.0, 6);
  });

  it("reports the per-event Gross as the charge, matching the GMV column above it", async () => {
    const { events } = await getCommissionOverview();

    // Both earning rows at their full charge. This column sits beside "Fee
    // charged", which is read off amount/platform_fee, so netting the refund out
    // here would make commission/gross imply a rate nobody is on.
    expect(events[0].gross).toBe(400000);
    expect(events[0].commission).toBe(12000);
    expect(events[0].paid_count).toBe(2); // the fully refunded row is not an earning row
  });

  it("values BOTH refund kinds at refunded_amount, never at the charge", async () => {
    const { totals } = await getCommissionOverview();

    // 191000 (full: net_to_org) + 161000 (partial) = 352000. Reading `amount` on
    // the full-refund arm gave 200000 + 161000 = 361000, over-stating by the ₱60
    // commission plus PayMongo's ₱30 — money that was never returned.
    expect(totals.refunded_cents).toBe(352000);
    expect(totals.refunded_cents).not.toBe(361000);
    expect(totals.refund_count).toBe(2);
  });

  it("keeps a fully refunded row out of gross, commission and net", async () => {
    const { totals } = await getCommissionOverview();

    // Those come from admin_org_totals_v, which excludes 'refunded' rows — so the
    // ₱2,000 refunded entry above must not appear in any of them.
    expect(totals.charged_gross).toBe(400000);
    expect(totals.gross).toBe(239000);
    expect(totals.commission).toBe(12000);
    expect(totals.net_to_org).toBe(221000);
    expect(totals.paid_count).toBe(2);
  });

  it("reads an org with no payments as zeroes rather than dividing by zero", async () => {
    byTable.admin_org_totals_v = [];
    byTable.admin_payments_v = [];

    const { orgs, totals } = await getCommissionOverview();

    expect(orgs[0].charged_gross).toBe(0);
    expect(orgs[0].gross_revenue).toBe(0);
    expect(orgs[0].avg_entry_cents).toBe(0);
    expect(totals.refunded_cents).toBe(0);
    expect(totals.charged_gross).toBe(0);
  });
});
