import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTableParams } from "@/lib/table-params";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";
import type { PaymentRow } from "@/lib/queries/payments";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

const listOrgPayments = vi.hoisted(() => vi.fn());
const listOrgPaymentMethods = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/payments", () => ({ listOrgPayments, listOrgPaymentMethods }));

import { PaymentsTableSection } from "./table-section";

beforeEach(() => {
  resetTableParamsSpies();
  listOrgPayments.mockReset();
  listOrgPaymentMethods.mockReset();
});

const rows: PaymentRow[] = [
  {
    registration_id: "r1", event_id: "ev-1", event_name: "Kitanglad Skyline Ultra", user_id: "u1",
    full_name: "Maria Josefa Santos", avatar_url: null, amount: 285000, platform_fee: 14250, net_to_org: 270750,
    method: "gcash", status: "paid", created_at: "2026-08-03T09:14:00Z",
  },
];

describe("PaymentsTableSection", () => {
  it("renders rows from listOrgPayments, scoped to the given org and filters as the KPI row", async () => {
    listOrgPayments.mockResolvedValue({ rows, total: 1 });
    listOrgPaymentMethods.mockResolvedValue(["gcash", "card"]);
    const params = parseTableParams({}, { sort: [], filters: { status: "all", method: "all", event: "all" } });

    render(await PaymentsTableSection({ orgId: "org-1", params }));

    expect(listOrgPayments).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", method: "all" }) }),
    );
    expect(screen.getByText("Maria Josefa Santos")).toBeInTheDocument();
  });

  // The Method filter's options come from the data, so the section has to
  // read them separately — and read them UNFILTERED. Passing `params` here
  // would make selecting GCash collapse the list to GCash alone, with no way
  // back to the other methods.
  it("reads the method options scoped to the org only, ignoring the active filters", async () => {
    listOrgPayments.mockResolvedValue({ rows: [], total: 0 });
    listOrgPaymentMethods.mockResolvedValue(["gcash"]);
    const params = parseTableParams({ method: "gcash" }, { sort: [], filters: { status: "all", method: "all", event: "all" } });

    render(await PaymentsTableSection({ orgId: "org-1", params }));

    // `lastCall`, not `toHaveBeenCalledWith` — the whole argument list has to
    // be exactly `["org-1"]`. `toHaveBeenCalledWith("org-1")` would still pass
    // if a second `params` argument were added, which is the mistake this test
    // exists to catch.
    expect(listOrgPaymentMethods.mock.lastCall).toEqual(["org-1"]);
  });
});
