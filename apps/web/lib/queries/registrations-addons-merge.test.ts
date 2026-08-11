import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";

// getRegistrationAddons itself is unit-tested against a mocked query builder
// in registrations-addons.test.ts, and RegistrationDetail is tested against
// a hand-built row fixture in RegistrationDetail.test.tsx — but nothing
// pinned the SEAM between them: that listEventRegistrations actually calls
// getRegistrationAddons and merges its result onto the matching row by id.
// `addons: addonsById.get(r.id) ?? []` silently regressing to `addons: []`
// left the entire suite green before this file existed — this is the test
// that catches it.
//
// Table-aware `from()`, unlike registrations-emails.test.ts's mock: that
// mock doesn't distinguish by table name (harmless there, since it only
// asserts on `.email`), but this file needs to hand back DIFFERENT data for
// the main row read (`admin_registrations_v`, via `.range()`) versus the
// add-ons read (`registration_addons`, via `.in()`) to prove the merge is
// keyed correctly rather than coincidentally matching.
const listData = vi.fn();
const addonsData = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "registration_addons") {
        return { select: () => ({ in: () => Promise.resolve(addonsData()) }) };
      }
      const builder: Record<string, unknown> = {};
      ["select", "eq", "order", "range", "or"].forEach((m) => { builder[m] = () => builder; });
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(listData());
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
  listData.mockReset();
  addonsData.mockReset();
});

describe("listEventRegistrations — add-on merge", () => {
  it("merges each row's add-ons from getRegistrationAddons, matched by id, and gives a row with none an empty array", async () => {
    listData.mockReturnValue({
      data: [
        { id: "r1", user_id: "u1", category_id: "c1", category_label: "50K", full_name: "Maria Santos", bib_name: "D-1", total_amount: 100000, payment_status: "paid", payment_method: "gcash", custom_data: {}, created_at: "2026-08-03T09:14:00Z" },
        { id: "r2", user_id: "u2", category_id: "c1", category_label: "50K", full_name: "Ramon Cruz", bib_name: null, total_amount: 200000, payment_status: "pending", payment_method: null, custom_data: {}, created_at: "2026-08-03T08:00:00Z" },
      ],
      count: 2,
      error: null,
    });
    addonsData.mockReturnValue({
      data: [{ registration_id: "r1", price: 60000, addons: { name: "Singlet" } }],
      error: null,
    });

    // includeEmails: false — this test is about the add-ons seam only, and
    // skipping the email RPC keeps the mock (and any failure here) unambiguous.
    const { rows } = await listEventRegistrations("event-1", params(), { includeEmails: false });

    expect(rows.find((r) => r.id === "r1")?.addons).toEqual([{ name: "Singlet", price: 60000 }]);
    expect(rows.find((r) => r.id === "r2")?.addons).toEqual([]);
  });

  it("skips the add-ons read entirely when includeAddons is false (the export route's case)", async () => {
    listData.mockReturnValue({
      data: [{ id: "r1", user_id: "u1", category_id: "c1", category_label: "50K", full_name: "Maria Santos", bib_name: "D-1", total_amount: 100000, payment_status: "paid", payment_method: "gcash", custom_data: {}, created_at: "2026-08-03T09:14:00Z" }],
      count: 1,
      error: null,
    });

    const { rows } = await listEventRegistrations("event-1", params(), { includeEmails: false, includeAddons: false });

    expect(rows[0].addons).toEqual([]);
    expect(addonsData).not.toHaveBeenCalled();
  });
});
