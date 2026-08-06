import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationsTable } from "./registrations-table";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { tableParamsSpies, tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

beforeEach(() => {
  resetTableParamsSpies();
});

const rows: RegistrationRow[] = [
  {
    id: "r1", user_id: "u1", category_id: "c1", category_label: "50K Ultra",
    full_name: "Maria Josefa Santos", bib_name: "MJ", total_amount: 285000,
    payment_status: "paid", payment_method: "gcash",
    created_at: "2026-08-03T09:14:00Z", custom_data: {},
  },
];

const props = {
  rows, total: 1, page: 1, per: 25, sort: [], activeFilters: {}, q: "",
  categories: [{ id: "c1", label: "50K Ultra" }],
};

describe("RegistrationsTable", () => {
  it("renders the runner name and category", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("Maria Josefa Santos")).toBeInTheDocument();
    expect(screen.getByText("50K Ultra")).toBeInTheDocument();
  });

  it("formats centavos as pesos", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("₱2,850")).toBeInTheDocument();
  });

  it("builds the category filter from the event's categories", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  // THE headline requirement of Task 7: Registrations is scoped by ?event=,
  // and DataTable's "Clear all" wipes every param except sort/per/whatever
  // is named in preserveOnClear. If this page fails to pass
  // preserveOnClear={["event"]}, clicking "Clear all" silently moves the
  // admin to a different event's registrations with no visible cause.
  it("passes preserveOnClear=[\"event\"] so Clear all cannot drop the event scope", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} activeFilters={{ status: "paid" }} />);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(tableParamsSpies.clearFilters).toHaveBeenCalledWith(["event"]);
  });
});
