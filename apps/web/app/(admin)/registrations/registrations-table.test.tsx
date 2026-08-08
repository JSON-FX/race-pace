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
    full_name: "Maria Josefa Santos", bib_name: "D-1042", email: "maria.santos@gmail.com",
    total_amount: 285000, payment_status: "paid", payment_method: "gcash",
    created_at: "2026-08-03T09:14:00Z", custom_data: {}, addons: [],
  },
  {
    id: "r2", user_id: "u2", category_id: "c1", category_label: "25K",
    full_name: "Angelo Lim", bib_name: null, email: "angelo.lim@yahoo.com",
    total_amount: 195000, payment_status: "pending", payment_method: null,
    created_at: "2026-08-03T08:31:00Z", custom_data: {}, addons: [],
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

  // Was "... via setFilter, not local state" — closeReg now routes through
  // `patch` directly (setFilter unconditionally clears `page`, which is wrong
  // for a modal address; see the page-2 bug tests below), so a name pinning
  // the old mechanism would be actively misleading to the next reader.
  it("closing the sheet clears ?reg=, not local state", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} activeFilters={{ reg: "r1" }} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ reg: null });
  });

  // Was "... by setting ?reg= via setFilter" — same rename reason as above.
  it("clicking a runner name opens the sheet by setting ?reg=", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getByText("Maria Josefa Santos"));
    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ reg: "r1" });
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

  // Regression: a `disabled` <button> is pulled out of the tab order
  // entirely, and the tooltip wrapper around it used to be a bare <span>
  // with no tabIndex — also unreachable by keyboard. A keyboard/screen-reader
  // user got three greyed buttons with no way to find out why. The wrapper
  // must be a real focus stop that carries the explanation itself, not just
  // something a mouse hover reveals.
  it("makes the disabled bulk actions' explanation reachable by keyboard, not just mouse hover", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    const sendEmailButton = screen.getByRole("button", { name: /Send email/ });
    const wrapper = sendEmailButton.closest("span[tabindex]");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(wrapper).toHaveAttribute("aria-label", expect.stringMatching(/bulk email sending/i));
  });

  it("opens the bulk-cancel confirmation dialog with the selected ids, and does not cancel until confirmed", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(screen.getByText("Cancel 1 registration?")).toBeInTheDocument();
  });

  it("opens the detail modal without waiting for the URL to update", async () => {
    const user = userEvent.setup();
    // activeFilters has NO `reg` key and the mocked setFilter never writes one
    // back, so a modal that waits on the URL can never open here. That is the
    // regression this pins: before, `reg` was read straight from activeFilters
    // and opening cost a full server round trip.
    render(
      <RegistrationsTable
        rows={rows} total={2} page={1} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /View Maria Josefa Santos/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Still syncs the URL behind the modal, so the registration stays linkable.
    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ reg: "r1" });
  });

  it("closes the modal without waiting for the URL either", async () => {
    const user = userEvent.setup();
    // Opposite direction: `reg` IS in the URL and the mock will never clear it.
    render(
      <RegistrationsTable
        rows={rows} total={2} page={1} per={25} sort={[]}
        activeFilters={{ reg: "r1" }} q="" categories={[]}
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ reg: null });
  });

  // THE page-2 bug: `reg` is a modal address, not a filter, so opening one must
  // NOT reset pagination. setFilter unconditionally patches `page: null`, which
  // sent the server back to page 1, replaced `rows` with page-1 rows, and left
  // rows.find(selectedId) with nothing to find — the modal silently never
  // appeared and the admin lost their place in the list.
  it("does not reset pagination when opening a registration", async () => {
    const user = userEvent.setup();
    render(
      <RegistrationsTable
        rows={rows} total={60} page={2} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /View Maria Josefa Santos/ }));

    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ reg: "r1" });
    // Assert the absence explicitly: a patch carrying `page: null` is exactly
    // the bug, and a test that only checked `reg` would still pass with it.
    const [arg] = tableParamsSpies.patch.mock.calls.at(-1) as [Record<string, unknown>];
    expect(arg).not.toHaveProperty("page");
  });

  it("does not reset pagination when closing a registration", async () => {
    const user = userEvent.setup();
    render(
      <RegistrationsTable
        rows={rows} total={60} page={2} per={25} sort={[]}
        activeFilters={{ reg: "r1" }} q="" categories={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ reg: null });
    const [arg] = tableParamsSpies.patch.mock.calls.at(-1) as [Record<string, unknown>];
    expect(arg).not.toHaveProperty("page");
  });
});
