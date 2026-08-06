import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue, toIlikePattern } from "./events";

const rpcMock = vi.fn();
const orCapture = vi.fn();
const eqCapture = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: rpcMock,
    from: () => {
      const builder: Record<string, unknown> = {};
      ["select", "order", "range"].forEach((m) => { builder[m] = () => builder; });
      // Captured, not a no-op: the event filter reaching the LIST query is half
      // of the card/table parity invariant asserted below.
      builder.eq = (col: string, val: unknown) => { eqCapture(col, val); return builder; };
      builder.or = (arg: string) => { orCapture(arg); return builder; };
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [], count: 0, error: null });
      return builder;
    },
  }),
}));

import { getPaymentAggregates, listOrgPayments } from "./payments";

const params = (overrides: Partial<TableParams> = {}): TableParams => ({
  page: 1,
  per: 25,
  sort: [],
  filters: { status: "all", method: "all", event: "all" },
  q: "",
  ...overrides,
});

describe("getPaymentAggregates", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    orCapture.mockReset();
    eqCapture.mockReset();
  });

  it("calls the RPC with the SAME org id and filters as the table query — filter parity is structural", async () => {
    rpcMock.mockResolvedValue({ data: [{ gross_cents: 0, fee_cents: 0, net_cents: 0, refunded_cents: 0 }], error: null });

    await getPaymentAggregates("org-1", params({
      filters: { status: "paid", method: "gcash", event: "ev-9" }, q: "  cruz  ",
    }));

    expect(rpcMock).toHaveBeenCalledWith("admin_payment_aggregates", {
      p_org_id: "org-1",
      p_status: "paid",
      p_method: "gcash",
      p_event_id: "ev-9",
      p_q: "%cruz%", // trimmed AND wildcard-wrapped, via the shared searchPattern() helper
    });
  });

  it("defaults the event filter to the 'all' sentinel, never null", async () => {
    // A null would reach `v.event_id::text = null` in SQL, which is NULL rather
    // than true — every card would silently read zero for an unfiltered page.
    rpcMock.mockResolvedValue({ data: [{ gross_cents: 0, fee_cents: 0, net_cents: 0, refunded_cents: 0 }], error: null });

    await getPaymentAggregates("org-1", params({}));

    expect(rpcMock).toHaveBeenCalledWith(
      "admin_payment_aggregates",
      expect.objectContaining({ p_event_id: "all" }),
    );
  });

  it("scopes the KPI cards and the table to the SAME event", async () => {
    // The invariant this whole RPC exists for. If the table filtered by event
    // and the cards did not, "Gross ₱5,900" would sit above two rows totalling
    // ₱2,100 — the failure mode that motivated moving these sums into Postgres.
    rpcMock.mockResolvedValue({ data: [{ gross_cents: 0, fee_cents: 0, net_cents: 0, refunded_cents: 0 }], error: null });

    const withEvent = params({ filters: { event: "ev-42" } });
    await getPaymentAggregates("org-1", withEvent);
    await listOrgPayments("org-1", withEvent);

    expect(rpcMock).toHaveBeenCalledWith(
      "admin_payment_aggregates",
      expect.objectContaining({ p_event_id: "ev-42" }),
    );
    expect(eqCapture).toHaveBeenCalledWith("event_id", "ev-42");
  });

  // IMPORTANT 1 regression, Payments side: same requirement as Registrations
  // — a '*' must normalize identically for the RPC and the list query.
  it("normalizes a '*' in the search term IDENTICALLY for the aggregate RPC and the list query", async () => {
    rpcMock.mockResolvedValue({ data: [{ gross_cents: 0, fee_cents: 0, net_cents: 0, refunded_cents: 0 }], error: null });

    const rawTerm = "Dahi*Sky";
    const expectedPattern = toIlikePattern(rawTerm);

    await getPaymentAggregates("org-1", params({ q: rawTerm }));
    await listOrgPayments("org-1", params({ q: rawTerm }));

    expect(rpcMock).toHaveBeenCalledWith("admin_payment_aggregates", expect.objectContaining({ p_q: expectedPattern }));

    const expectedOrArg = `full_name.ilike.${quotePostgrestValue(expectedPattern)},event_name.ilike.${quotePostgrestValue(expectedPattern)}`;
    expect(orCapture).toHaveBeenCalledWith(expectedOrArg);
  });

  it("passes net_to_org straight through — it must never be recomputed as amount minus fee client-side", async () => {
    // A row deliberately chosen so amount - fee !== net, to prove the reader
    // does not silently "fix" it — that would let the card disagree with the
    // ledger the moment a real-world adjustment makes the two diverge.
    rpcMock.mockResolvedValue({
      data: [{ gross_cents: 600000, fee_cents: 30000, net_cents: 555000, refunded_cents: 120000 }],
      error: null,
    });

    const result = await getPaymentAggregates("org-1", params());

    expect(result.netCents).toBe(555000);
    expect(result.netCents).not.toBe(result.grossCents - result.feeCents);
  });

  it("coerces bigint-as-string wire values to numbers", async () => {
    rpcMock.mockResolvedValue({
      data: [{ gross_cents: "600000", fee_cents: "30000", net_cents: "456000", refunded_cents: "120000" }],
      error: null,
    });

    const result = await getPaymentAggregates("org-1", params());

    expect(result).toEqual({ grossCents: 600000, feeCents: 30000, netCents: 456000, refundedCents: 120000 });
  });

  it("degrades to zeroed aggregates on query error rather than throwing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await getPaymentAggregates("org-1", params());

    expect(result).toEqual({ grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 });
  });

  it("returns zeroed aggregates (not blank) for a genuinely empty filtered set", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await getPaymentAggregates("org-1", params());

    expect(result).toEqual({ grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 });
  });
});
