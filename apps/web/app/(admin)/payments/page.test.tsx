import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PaymentsPage from "./page";
import type { PaymentAggregates, PaymentRow } from "@/lib/queries/payments";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

// The happy-path tests below render past the KPI row into <PaymentsTable>
// (a <DataTable>), which calls Next's router hooks — mock the same way every
// other DataTable-rendering test in this app does.
vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

const { listOrgPayments, getPaymentAggregates, getMyRoles } = vi.hoisted(() => ({
  // Explicit return-type annotations, not inference, on these throwing
  // defaults: an arrow function whose body is only `throw` infers `never`,
  // which then rejects every later `.mockResolvedValue(...)` call below with
  // "not assignable to parameter of type 'never'".
  listOrgPayments: vi.fn((): Promise<{ rows: PaymentRow[]; total: number }> => {
    throw new Error("must not be called");
  }),
  getPaymentAggregates: vi.fn((): Promise<PaymentAggregates> => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/payments", () => ({ listOrgPayments, getPaymentAggregates }));

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("PaymentsPage", () => {
  beforeEach(() => resetTableParamsSpies());

  it("renders NoOrgScope and never queries payments when the caller has no org", async () => {
    // A bare super_admin: isAdmin true (clears the (admin) layout guard) but
    // orgId null — there's no organization to scope a payments query to.
    // Querying with a null org id 500s rather than returning an empty list,
    // so the page must branch before calling any query at all.
    getMyRoles.mockResolvedValue({ role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });

    const ui = await PaymentsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgPayments).not.toHaveBeenCalled();
    expect(getPaymentAggregates).not.toHaveBeenCalled();
  });

  it("renders the KPI row from the aggregates reader, scoped to the same org and filters as the table", async () => {
    getMyRoles.mockResolvedValue({ role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true });
    listOrgPayments.mockResolvedValue({ rows: [], total: 3 });
    getPaymentAggregates.mockResolvedValue({ grossCents: 600000, feeCents: 30000, netCents: 456000, refundedCents: 120000 });

    const ui = await PaymentsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(getPaymentAggregates).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", method: "all" }) }),
    );
    expect(listOrgPayments).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", method: "all" }) }),
    );

    expect(screen.getByText("Gross")).toBeInTheDocument();
    expect(screen.getByText("₱6,000")).toBeInTheDocument();
    expect(screen.getByText("Platform fees")).toBeInTheDocument();
    expect(screen.getByText("₱300")).toBeInTheDocument();
    expect(screen.getByText("Net to org")).toBeInTheDocument();
    // Deliberately not amount - fee (₱5,700): proves the page renders whatever
    // getPaymentAggregates returns for net rather than recomputing it.
    expect(screen.getByText("₱4,560")).toBeInTheDocument();
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("₱1,200")).toBeInTheDocument();
  });

  it("renders zeroed KPI cards, not a blank row, when the filtered set is empty", async () => {
    getMyRoles.mockResolvedValue({ role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true });
    listOrgPayments.mockResolvedValue({ rows: [], total: 0 });
    getPaymentAggregates.mockResolvedValue({ grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 });

    const ui = await PaymentsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getAllByText("₱0").length).toBe(4);
  });
});
