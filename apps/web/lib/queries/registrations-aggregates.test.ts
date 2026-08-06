import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue, toIlikePattern } from "./events";

const rpcMock = vi.fn();
const orCapture = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: rpcMock,
    from: () => {
      const builder: Record<string, unknown> = {};
      ["select", "eq", "order", "range"].forEach((m) => { builder[m] = () => builder; });
      builder.or = (arg: string) => { orCapture(arg); return builder; };
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [], count: 0, error: null });
      return builder;
    },
  }),
}));

import { getRegistrationAggregates, listEventRegistrations } from "./registrations";

const params = (overrides: Partial<TableParams> = {}): TableParams => ({
  page: 1,
  per: 25,
  sort: [],
  filters: { status: "all", category: "all" },
  q: "",
  ...overrides,
});

describe("getRegistrationAggregates", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    orCapture.mockReset();
  });

  it("calls the RPC with the SAME event id and filters as the table query — filter parity is structural", async () => {
    rpcMock.mockResolvedValue({
      data: [{ total: 4, paid: 2, gross_cents: 480000, refund_count: 1, refunded_cents: 120000, new_this_week: 2 }],
      error: null,
    });

    await getRegistrationAggregates(
      "event-1",
      params({ filters: { status: "paid", category: "cat-1" }, q: "  ana  " }),
    );

    expect(rpcMock).toHaveBeenCalledWith("admin_registration_aggregates", {
      p_event_id: "event-1",
      p_status: "paid",
      p_category_id: "cat-1",
      p_q: "%ana%", // trimmed AND wildcard-wrapped, via the shared searchPattern() helper
    });
  });

  // IMPORTANT 1 regression: a '*' in the search box must produce the SAME
  // pattern for the RPC (getRegistrationAggregates) and the list query
  // (listEventRegistrations) — both must route through the one shared
  // searchPattern()/toIlikePattern() normalization, not build their own
  // '%'+term+'%' independently. If they ever diverge again, this test fails.
  it("normalizes a '*' in the search term IDENTICALLY for the aggregate RPC and the list query", async () => {
    rpcMock.mockResolvedValue({ data: [{ total: 1, paid: 1, gross_cents: 0, refund_count: 0, refunded_cents: 0, new_this_week: 0 }], error: null });

    const rawTerm = "Dahi*Sky";
    const expectedPattern = toIlikePattern(rawTerm);
    expect(expectedPattern).toBe("%Dahi%Sky%"); // sanity: '*' really did become '%'

    await getRegistrationAggregates("event-1", params({ q: rawTerm }));
    await listEventRegistrations("event-1", params({ q: rawTerm }));

    expect(rpcMock).toHaveBeenCalledWith("admin_registration_aggregates", expect.objectContaining({ p_q: expectedPattern }));

    const expectedOrArg = `full_name.ilike.${quotePostgrestValue(expectedPattern)},bib_name.ilike.${quotePostgrestValue(expectedPattern)}`;
    expect(orCapture).toHaveBeenCalledWith(expectedOrArg);
  });

  it("defaults status/category to 'all' and q to '' when unset, matching the table's untouched filters", async () => {
    rpcMock.mockResolvedValue({ data: [{ total: 0, paid: 0, gross_cents: 0, refund_count: 0, refunded_cents: 0, new_this_week: 0 }], error: null });

    await getRegistrationAggregates("event-1", params({ filters: {} }));

    expect(rpcMock).toHaveBeenCalledWith("admin_registration_aggregates", {
      p_event_id: "event-1",
      p_status: "all",
      p_category_id: "all",
      p_q: "",
    });
  });

  it("maps the RPC row into camelCase cents, coercing bigint-as-string wire values", async () => {
    // PostgREST/postgres bigint often arrives as a JSON string over the wire —
    // the reader must Number() it, not pass it through and let peso() choke.
    rpcMock.mockResolvedValue({
      data: [{ total: 4, paid: 2, gross_cents: "480000", refund_count: 1, refunded_cents: "120000", new_this_week: 2 }],
      error: null,
    });

    const result = await getRegistrationAggregates("event-1", params());

    expect(result).toEqual({
      total: 4,
      paid: 2,
      grossCents: 480000,
      refundCount: 1,
      refundedCents: 120000,
      newThisWeek: 2,
    });
  });

  it("degrades to zeroed aggregates on query error rather than throwing — the table must still render", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await getRegistrationAggregates("event-1", params());

    expect(result).toEqual({ total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0 });
  });

  it("returns zeroed aggregates (not blank/undefined) for a genuinely empty filtered set", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await getRegistrationAggregates("event-1", params());

    expect(result).toEqual({ total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0 });
  });
});
