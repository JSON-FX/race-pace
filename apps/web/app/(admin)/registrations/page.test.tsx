import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RegistrationsPage from "./page";
import type { RegistrationAggregates, RegistrationRow } from "@/lib/queries/registrations";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

// The happy-path tests below render past the KPI row into <RegistrationsTable>
// (a <DataTable>) and <EventPicker>, both of which call Next's router hooks —
// mock the same way every other DataTable-rendering test in this app does.
vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/registrations",
}));

const {
  listEventRegistrations, listOrgEventOptions, listEventCategories, getRegistrationAggregates,
  getOrgRegistrationCount, getOrgPendingRegistrationCount, getMyRoles,
} = vi.hoisted(() => ({
  // Explicit return-type annotations, not inference, on these throwing
  // defaults: an arrow function whose body is only `throw` infers `never`,
  // which then rejects every later `.mockResolvedValue(...)` call below with
  // "not assignable to parameter of type 'never'".
  listEventRegistrations: vi.fn((): Promise<{ rows: RegistrationRow[]; total: number }> => {
    throw new Error("must not be called");
  }),
  listOrgEventOptions: vi.fn((): Promise<{ id: string; name: string; count: number }[]> => {
    throw new Error("must not be called");
  }),
  listEventCategories: vi.fn((): Promise<{ id: string; label: string }[]> => {
    throw new Error("must not be called");
  }),
  getRegistrationAggregates: vi.fn((): Promise<RegistrationAggregates> => {
    throw new Error("must not be called");
  }),
  // Header-subtitle figures ("N total across M events · K pending payment")
  // — org-wide, independent of the event/filters scope above.
  getOrgRegistrationCount: vi.fn((): Promise<number> => {
    throw new Error("must not be called");
  }),
  getOrgPendingRegistrationCount: vi.fn((): Promise<number> => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/registrations", () => ({
  listEventRegistrations,
  listOrgEventOptions,
  listEventCategories,
  getRegistrationAggregates,
  getOrgRegistrationCount,
  getOrgPendingRegistrationCount,
}));

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("RegistrationsPage", () => {
  beforeEach(() => resetTableParamsSpies());

  it("renders NoOrgScope and never queries registrations when the caller has no org", async () => {
    // A bare super_admin: isAdmin true (clears the (admin) layout guard) but
    // orgId null — there's no organization to scope a registrations query
    // to. Querying with a null org id 500s rather than returning an empty
    // list, so the page must branch before calling any query at all.
    getMyRoles.mockResolvedValue({ role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgEventOptions).not.toHaveBeenCalled();
    expect(listEventRegistrations).not.toHaveBeenCalled();
    expect(listEventCategories).not.toHaveBeenCalled();
    expect(getRegistrationAggregates).not.toHaveBeenCalled();
  });

  it("renders the KPI row from the aggregates reader, scoped to the same event as the table", async () => {
    getMyRoles.mockResolvedValue({ role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true });
    listOrgEventOptions.mockResolvedValue([{ id: "event-1", name: "Dahilayan Sky Ultra", count: 4 }]);
    listEventRegistrations.mockResolvedValue({ rows: [], total: 4 });
    listEventCategories.mockResolvedValue([]);
    getRegistrationAggregates.mockResolvedValue({
      total: 4, paid: 2, grossCents: 480000, refundCount: 1, refundedCents: 120000, newThisWeek: 2,
    });
    getOrgRegistrationCount.mockResolvedValue(4);
    getOrgPendingRegistrationCount.mockResolvedValue(1);

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    // Same event id and same (default) filters reach the aggregates reader
    // as reach the table's own list query — that's the "structural, not
    // remembered" filter parity the KPI row depends on.
    expect(getRegistrationAggregates).toHaveBeenCalledWith(
      "event-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
    );
    expect(listEventRegistrations).toHaveBeenCalledWith(
      "event-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
    );

    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("+2 this week")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("50.0% conversion")).toBeInTheDocument();
    expect(screen.getByText("Gross revenue")).toBeInTheDocument();
    expect(screen.getByText("₱4,800")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("₱1,200")).toBeInTheDocument();
    // "1 request", NOT "1 request · 0 pending" — there is no refund-approval
    // queue backing a pending count, so asserting "0 pending" would claim an
    // answer the system doesn't have. See IMPORTANT 3 in the V2 review. (The
    // page header subtitle DOES say "pending payment" — that's the org-wide
    // payment_status='pending' count, a real query, not the same "no data"
    // case as the refund queue.)
    expect(screen.getByText("1 request")).toBeInTheDocument();
    // The subtitle's figures each live in their own `<span>` (for
    // `font-mono tabular`), so its full text is split across sibling nodes —
    // match against the header <p>'s own textContent rather than
    // getByText's default (direct-text-node-only) matching.
    expect(
      screen.getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "4 total across 1 event · 1 pending payment",
      ),
    ).toBeInTheDocument();
  });

  it("renders zeroed KPI cards, not a blank row, when the filtered set is empty", async () => {
    getMyRoles.mockResolvedValue({ role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true });
    listOrgEventOptions.mockResolvedValue([{ id: "event-1", name: "Dahilayan Sky Ultra", count: 0 }]);
    listEventRegistrations.mockResolvedValue({ rows: [], total: 0 });
    listEventCategories.mockResolvedValue([]);
    getRegistrationAggregates.mockResolvedValue({
      total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0,
    });
    getOrgRegistrationCount.mockResolvedValue(0);
    getOrgPendingRegistrationCount.mockResolvedValue(0);

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("+0 this week")).toBeInTheDocument();
    expect(screen.getByText("0.0% conversion")).toBeInTheDocument();
    expect(screen.getAllByText("₱0").length).toBeGreaterThanOrEqual(2); // gross revenue + refunds
    expect(screen.getByText("0 requests")).toBeInTheDocument();
    // Refunds delta stays "0 requests" (not "0 requests · 0 pending" — no
    // refund-approval queue exists to answer that question, see the test
    // above). The header subtitle's "0 pending payment" is a different,
    // real figure (org-wide payment_status='pending' count) and is expected
    // to be present here.
    expect(
      screen.getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "0 total across 1 event · 0 pending payment",
      ),
    ).toBeInTheDocument();
  });
});
