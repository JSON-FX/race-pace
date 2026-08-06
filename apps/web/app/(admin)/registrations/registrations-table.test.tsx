import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationsTable } from "./registrations-table";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { tableParamsSpies, tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

// RegistrationDetail fetches add-ons via the browser Supabase client on
// mount — stub it so opening the sheet in these tests doesn't require real
// NEXT_PUBLIC_SUPABASE_* env vars or a network call.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

beforeEach(() => {
  resetTableParamsSpies();
});

const rows: RegistrationRow[] = [
  {
    id: "r1", user_id: "u1", category_id: "c1", category_label: "50K Ultra",
    full_name: "Maria Josefa Santos", bib_name: "D-1042", email: "maria.santos@gmail.com",
    total_amount: 285000, payment_status: "paid", payment_method: "gcash",
    created_at: "2026-08-03T09:14:00Z", custom_data: {},
  },
  {
    id: "r2", user_id: "u2", category_id: "c1", category_label: "25K",
    full_name: "Angelo Lim", bib_name: null, email: "angelo.lim@yahoo.com",
    total_amount: 195000, payment_status: "pending", payment_method: null,
    created_at: "2026-08-03T08:31:00Z", custom_data: {},
  },
];

const props = {
  rows, total: 2, page: 1, per: 25, sort: [], activeFilters: {}, q: "",
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

  // MINOR 3: the detail sheet is deep-linkable via ?reg=<id> (restored to
  // match the old SPA — an admin can bookmark or paste a link to a specific
  // registration), driven from `activeFilters.reg` rather than local state.
  it("opens the detail sheet for the registration named in ?reg=", () => {
    render(<RegistrationsTable {...props} activeFilters={{ reg: "r1" }} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The name renders once in the table row and again in the sheet header.
    expect(screen.getAllByText("Maria Josefa Santos").length).toBeGreaterThanOrEqual(2);
  });

  it("does not render an active-filter chip for reg (it has no FilterDef)", () => {
    render(<RegistrationsTable {...props} activeFilters={{ reg: "r1" }} />);
    // ActiveFilters only builds chips from filterDefs (status/category) plus
    // q — reg isn't in filterDefs, same as `event` already isn't, so with no
    // other filter active there should be no chips row at all, and
    // therefore no "Clear all" button either.
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("closing the sheet clears ?reg= via setFilter, not local state", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} activeFilters={{ reg: "r1" }} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(tableParamsSpies.setFilter).toHaveBeenCalledWith("reg", "all");
  });

  it("clicking a runner name opens the sheet by setting ?reg= via setFilter", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getByText("Maria Josefa Santos"));
    expect(tableParamsSpies.setFilter).toHaveBeenCalledWith("reg", "r1");
  });

  // Table cell composition (visual parity V3): the Runner cell is now an
  // avatar + name-over-email "who" cell, not just a bare name.
  it("renders the runner's email under their name", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("maria.santos@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("MJ")).toBeInTheDocument(); // avatar initials
  });

  // Bib column: font-mono value when assigned, em-dash fallback when not —
  // r1 has a bib, r2 doesn't.
  it("renders the Bib column with an em-dash fallback for an unassigned bib", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("D-1042")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // "Send email"/"Assign bibs"/"Mark checked-in" have no real backend yet
  // (see task-v3-report.md) — they must render disabled, not silently do
  // nothing when clicked.
  it("renders the backend-less bulk actions as disabled once rows are selected", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    expect(screen.getByRole("button", { name: /Send email/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Assign bibs/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Mark checked-in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Cancel$/ })).not.toBeDisabled();
  });

  it("opens the bulk-cancel confirmation dialog with the selected ids, and does not cancel until confirmed", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(screen.getByText("Cancel 1 registration?")).toBeInTheDocument();
  });
});
