import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentsTable } from "./payments-table";
import type { PaymentRow } from "@/lib/queries/payments";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

beforeEach(() => {
  resetTableParamsSpies();
});

const rows: PaymentRow[] = [
  {
    registration_id: "r1", event_id: "e1", event_name: "Dahilayan Sky Ultra",
    user_id: "u1", full_name: "Maria Josefa Santos",
    amount: 285000, platform_fee: 14250, net_to_org: 270750,
    method: "gcash", status: "paid", created_at: "2026-08-03T09:14:00Z",
  },
];

const props = { rows, total: 1, page: 1, per: 25, sort: [], activeFilters: {}, q: "" };

describe("PaymentsTable", () => {
  it("shows gross, fee and net as distinct, correctly-formatted pesos", () => {
    render(<PaymentsTable {...props} />);
    // The three columns come straight from admin_payments_v — this would
    // catch a gross/net transposition, not just "some peso string exists".
    expect(screen.getByText("₱2,850")).toBeInTheDocument();
    expect(screen.getByText("₱142.50")).toBeInTheDocument();
    expect(screen.getByText("₱2,707.50")).toBeInTheDocument();
  });

  it("offers status and method filters", () => {
    render(<PaymentsTable {...props} />);
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Method")).toBeInTheDocument();
  });
});
