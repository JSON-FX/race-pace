import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // Deliberately scoped to the specific cell each value belongs to, by
  // header position (Runner, Gross, Fee, Net, Method, Status, Date) — NOT
  // three document-wide getByText calls. Three unscoped getByText("₱...")
  // assertions would still all pass if the Gross and Net column *wiring*
  // were swapped (amount <-> net_to_org): the same three strings would
  // still exist in the document, just in each other's cells, and this test
  // would stay green while organizers saw their gross reported as net and
  // vice versa. Asserting `cells[1]`/`cells[2]`/`cells[3]` by position is
  // what actually catches that transposition. Verified by temporarily
  // swapping `amount` and `net_to_org` in payments-table.tsx's column defs:
  // this test failed (cells[1] read "₱2,707.50" instead of "₱2,850"), then
  // passed again once the swap was reverted.
  it("shows gross, fee and net as distinct, correctly-formatted pesos in their own columns", () => {
    render(<PaymentsTable {...props} />);
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row; the one data row is rows[1].
    const cells = within(rows[1]).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("₱2,850"); // Gross
    expect(cells[2]).toHaveTextContent("₱142.50"); // Fee
    expect(cells[3]).toHaveTextContent("₱2,707.50"); // Net
  });

  it("offers status and method filters", () => {
    render(<PaymentsTable {...props} />);
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Method")).toBeInTheDocument();
  });

  // Nothing else asserts the Method filter's actual option set, so a future
  // edit that drops "paymongo" — silently undoing the fix for the
  // payment-verify fallback-confirm path (supabase/functions/payment-verify/
  // index.ts:52, which hardcodes method="paymongo" when it confirms ahead of
  // the webhook) — would not be caught by anything else in this file.
  it("offers all four real method values, including the payment-verify fallback's \"paymongo\"", async () => {
    const user = userEvent.setup();
    render(<PaymentsTable {...props} />);
    await user.click(screen.getByLabelText("Method"));
    expect(screen.getByRole("option", { name: "GCash" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Maya" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "PayMongo (other)" })).toBeInTheDocument();
  });
});
