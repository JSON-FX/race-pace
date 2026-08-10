import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";

// Task 9: 'expired'/'cancelled' MUST route to the registration_status column,
// not payment_status — payment_status has no such enum values, so routing
// them there throws a hard Postgres "invalid input value for enum
// payment_status" error instead of filtering anything (see
// supabase/migrations/20260809100400_admin_registrations_v_registration_status.sql's
// header comment). This test captures every `.eq()` call listEventRegistrations
// makes so a regression back to the old single-column routing fails loudly
// here rather than only at query time against a real database.
const eqCalls: [string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      ["select", "order", "range", "or"].forEach((m) => { builder[m] = () => builder; });
      builder.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return builder; };
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [], count: 0, error: null });
      return builder;
    },
  }),
}));

import { listEventRegistrations } from "./registrations";

const params = (overrides: Partial<TableParams> = {}): TableParams => ({
  page: 1,
  per: 25,
  sort: [],
  filters: { status: "all", category: "all" },
  q: "",
  ...overrides,
});

beforeEach(() => {
  eqCalls.length = 0;
});

describe("listEventRegistrations — status filter column routing", () => {
  it("routes an 'expired' filter to registration_status, never payment_status", async () => {
    await listEventRegistrations("event-1", params({ filters: { status: "expired", category: "all" } }), { includeEmails: false });
    expect(eqCalls).toContainEqual(["registration_status", "expired"]);
    expect(eqCalls.find(([col]) => col === "payment_status")).toBeUndefined();
  });

  it("routes a 'cancelled' filter to registration_status, never payment_status", async () => {
    await listEventRegistrations("event-1", params({ filters: { status: "cancelled", category: "all" } }), { includeEmails: false });
    expect(eqCalls).toContainEqual(["registration_status", "cancelled"]);
    expect(eqCalls.find(([col]) => col === "payment_status")).toBeUndefined();
  });

  it("still routes an ordinary status like 'paid' to payment_status, unaffected by the new routing", async () => {
    await listEventRegistrations("event-1", params({ filters: { status: "paid", category: "all" } }), { includeEmails: false });
    expect(eqCalls).toContainEqual(["payment_status", "paid"]);
    expect(eqCalls.find(([col]) => col === "registration_status")).toBeUndefined();
  });

  it("adds no status predicate at all for the 'all' sentinel", async () => {
    await listEventRegistrations("event-1", params(), { includeEmails: false });
    expect(eqCalls.find(([col]) => col === "payment_status" || col === "registration_status")).toBeUndefined();
  });
});
