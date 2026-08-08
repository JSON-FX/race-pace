import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";

// A dedicated mock (rather than reusing registrations-aggregates.test.ts's,
// whose `from()` always resolves empty) so these tests can exercise the
// email merge against actual rows.
//
// "in" is in the chainable list alongside the row-query verbs: every
// non-empty-rows call into listEventRegistrations now also fires
// getRegistrationAddons' `.from(...).select(...).in(...)` in parallel with
// the email RPC, and this mock's `from()` isn't table-aware, so that second
// call needs the same chain shape or it throws before either promise
// resolves. It's harmless here — these tests don't assert on `.addons`, only
// `.email`.
const rpcMock = vi.fn();
const listData = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: rpcMock,
    from: () => {
      const builder: Record<string, unknown> = {};
      ["select", "eq", "order", "range", "or", "in"].forEach((m) => { builder[m] = () => builder; });
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
  rpcMock.mockReset();
  listData.mockReset();
});

describe("listEventRegistrations — email merge", () => {
  it("merges each row's email from admin_registration_emails, scoped to the event", async () => {
    listData.mockReturnValue({
      data: [
        { id: "r1", user_id: "u1", category_id: "c1", category_label: "50K", full_name: "Maria Santos", bib_name: "D-1", total_amount: 100, payment_status: "paid", payment_method: "gcash", custom_data: {}, created_at: "2026-08-03T09:14:00Z" },
        { id: "r2", user_id: "u2", category_id: "c1", category_label: "50K", full_name: "Ramon Cruz", bib_name: null, total_amount: 200, payment_status: "pending", payment_method: null, custom_data: {}, created_at: "2026-08-03T08:00:00Z" },
      ],
      count: 2,
      error: null,
    });
    rpcMock.mockResolvedValue({
      data: [{ registration_id: "r1", email: "maria@example.com" }, { registration_id: "r2", email: "ramon@example.com" }],
      error: null,
    });

    const { rows } = await listEventRegistrations("event-1", params());

    expect(rpcMock).toHaveBeenCalledWith("admin_registration_emails", { p_event_id: "event-1" });
    expect(rows.find((r) => r.id === "r1")?.email).toBe("maria@example.com");
    expect(rows.find((r) => r.id === "r2")?.email).toBe("ramon@example.com");
  });

  it("degrades to null emails (not a thrown error) when the emails RPC fails", async () => {
    listData.mockReturnValue({
      data: [{ id: "r1", user_id: "u1", category_id: "c1", category_label: "50K", full_name: "Maria Santos", bib_name: "D-1", total_amount: 100, payment_status: "paid", payment_method: "gcash", custom_data: {}, created_at: "2026-08-03T09:14:00Z" }],
      count: 1,
      error: null,
    });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rows } = await listEventRegistrations("event-1", params());
    errorSpy.mockRestore();

    expect(rows[0].email).toBeNull();
  });

  it("skips the emails RPC entirely when the page has no rows", async () => {
    listData.mockReturnValue({ data: [], count: 0, error: null });

    const { rows } = await listEventRegistrations("event-1", params());

    expect(rows).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
