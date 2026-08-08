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
    user_id: "u1", full_name: "Maria Josefa Santos", avatar_url: null,
    amount: 285000, platform_fee: 14250, net_to_org: 270750,
    method: "gcash", status: "paid", created_at: "2026-08-03T09:14:00Z",
  },
];

const props = {
  rows, total: 1, page: 1, per: 25, sort: [], activeFilters: {}, q: "",
  // The distinct set `listOrgPaymentMethods` would return for this org.
  methods: ["gcash", "card", "paymaya", "paymongo"],
};

describe("PaymentsTable", () => {
  // Deliberately scoped to the specific cell each value belongs to, by
  // header position (Runner, Method, Gross, Fee, Net, Status, Date) — NOT
  // three document-wide getByText calls. Three unscoped getByText("₱...")
  // assertions would still all pass if the Gross and Net column *wiring*
  // were swapped (amount <-> net_to_org): the same three strings would
  // still exist in the document, just in each other's cells, and this test
  // would stay green while organizers saw their gross reported as net and
  // vice versa. Asserting `cells[2]`/`cells[3]`/`cells[4]` by position is
  // what actually catches that transposition. Verified by temporarily
  // swapping `amount` and `net_to_org` in payments-table.tsx's column defs:
  // this test failed (the Gross cell read "₱2,707.50" instead of "₱2,850"),
  // then passed again once the swap was reverted.
  //
  // The indices shifted by one when Method moved to second, the position the
  // money-flow spec gives it — hence the header assertion below, so a future
  // column reorder fails loudly here rather than quietly re-pointing these
  // three assertions at the wrong cells.
  it("shows gross, fee and net as distinct, correctly-formatted pesos in their own columns", () => {
    render(<PaymentsTable {...props} />);
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row; the one data row is rows[1].
    const headers = within(rows[0]).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Runner", "Method", "Gross", "Fee", "Net", "Status", "Date"]);
    const cells = within(rows[1]).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("₱2,850"); // Gross
    expect(cells[3]).toHaveTextContent("₱142.50"); // Fee
    expect(cells[4]).toHaveTextContent("₱2,707.50"); // Net
  });

  it("offers status and method filters", () => {
    render(<PaymentsTable {...props} />);
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Method")).toBeInTheDocument();
  });

  // The Method filter's options are the distinct values PRESENT in this org's
  // payments (listOrgPaymentMethods), not a list written into the component.
  // PayMongo owns the `source.type` vocabulary — a hardcoded list would hide
  // any instrument they add. "paymongo" earns its place the same way: it is a
  // real stored value (the pre-fix redirect path, plus rows the backfill
  // migration couldn't recover), and it reads as "Unknown", never as a card.
  it("builds the method options from the values actually present, labelling \"paymongo\" as unknown", async () => {
    const user = userEvent.setup();
    render(<PaymentsTable {...props} />);
    await user.click(screen.getByLabelText("Method"));
    expect(screen.getByRole("option", { name: "GCash" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Maya" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Unknown" })).toBeInTheDocument();
  });

  it("offers an instrument PayMongo added that this code has never heard of", async () => {
    const user = userEvent.setup();
    render(<PaymentsTable {...props} methods={["gcash", "grab_pay"]} />);
    await user.click(screen.getByLabelText("Method"));
    expect(screen.getByRole("option", { name: "grab_pay" })).toBeInTheDocument();
  });

  // A filter whose only entry is "All" is a control that can't do anything.
  it("hides the method filter entirely when no payment has a method yet", () => {
    render(<PaymentsTable {...props} methods={[]} />);
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.queryByLabelText("Method")).not.toBeInTheDocument();
  });

  it("shows the brand mark and label for a paid row, and \"Not yet paid\" for an unpaid one", () => {
    const unpaid: PaymentRow = {
      ...rows[0], registration_id: "r2", full_name: "Dana Lim",
      method: null, status: "pending",
    };
    render(<PaymentsTable {...props} rows={[rows[0], unpaid]} total={2} />);
    const tableRows = screen.getAllByRole("row");
    const paidMethodCell = within(tableRows[1]).getAllByRole("cell")[1];
    expect(paidMethodCell).toHaveTextContent("GCash");
    expect(paidMethodCell.querySelector("img")).not.toBeNull();

    const unpaidMethodCell = within(tableRows[2]).getAllByRole("cell")[1];
    expect(unpaidMethodCell).toHaveTextContent("Not yet paid");
    expect(unpaidMethodCell.querySelector("img")).toBeNull();
  });
});
