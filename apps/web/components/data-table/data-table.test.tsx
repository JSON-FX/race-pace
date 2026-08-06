import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { tableParamsSpies, tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

// Copy this exact one-liner into every test that renders <DataTable> (or
// anything else calling useTableParams()) — see the header comment in
// mock-table-params.ts for why it must be written directly in this file
// rather than delegated to a helper function.
vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

import { DataTable, type DataTableProps } from "./data-table";

type Row = { id: string; name: string; amount: number };

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "amount", header: "Amount" },
];

const rows: Row[] = [
  { id: "1", name: "Maria Santos", amount: 2850 },
  { id: "2", name: "Ramon Cruz", amount: 1950 },
];

const base: Pick<DataTableProps<Row>, "columns" | "data" | "total" | "page" | "per" | "sort" | "filterDefs" | "activeFilters" | "q"> = {
  columns, data: rows, total: 2, page: 1, per: 25,
  sort: [], filterDefs: [], activeFilters: {}, q: "",
};

describe("DataTable", () => {
  beforeEach(() => {
    resetTableParamsSpies();
  });

  it("renders every row", () => {
    render(<DataTable {...base} />);
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("Ramon Cruz")).toBeInTheDocument();
  });

  it("announces the result count to screen readers", () => {
    render(<DataTable {...base} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 results");
  });

  it("marks a sorted column with aria-sort", () => {
    render(<DataTable {...base} sort={[{ id: "amount", desc: true }]} />);
    expect(screen.getByRole("columnheader", { name: /amount/i })).toHaveAttribute("aria-sort", "descending");
  });

  it("shows the empty state instead of a bare table", () => {
    render(<DataTable {...base} data={[]} total={0} emptyState={{ title: "No registrations", description: "Nobody has signed up yet." }} />);
    expect(screen.getByText("No registrations")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Maria/ })).not.toBeInTheDocument();
  });

  it("shows a retryable error state", () => {
    render(<DataTable {...base} isError />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders one removable chip per active filter", async () => {
    render(
      <DataTable {...base}
        filterDefs={[{ key: "status", label: "Status", options: [{ value: "paid", label: "Paid" }] }]}
        activeFilters={{ status: "paid" }} />,
    );
    await userEvent.click(screen.getByLabelText("Remove Status filter"));
    // Assert on what DataTable itself calls (setFilter with the "all"
    // sentinel), not on the mock's own re-implementation of the "all" -> null
    // translation — that translation is real product logic now covered
    // directly in lib/use-table-params.test.ts.
    expect(tableParamsSpies.setFilter).toHaveBeenCalledWith("status", "all");
  });

  it("reveals bulk actions once rows are selected", async () => {
    const onSelect = vi.fn();
    render(<DataTable {...base} bulkActions={[{ label: "Send email", onSelect }]} getRowId={(r) => r.id} />);
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByLabelText("Select row")[0]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(onSelect).toHaveBeenCalledWith(["1"]);
  });

  // C2 regression: a bulk action must never receive an id that isn't in the
  // *current* data, even if the selection state hasn't been reset yet — the
  // reset effect (keyed on page/per/q/filters) is the fix, this intersection
  // is the seatbelt that must hold independently of it. Simulated here by
  // rerendering with different data while two rows are selected, which is
  // what happens in practice on a filter change or after a mutation shrinks
  // the list, whether or not the reset effect has flushed yet. This is the
  // seatbelt on a money operation (refund/cancel), so it pins the exact
  // argument handed to onSelect rather than just the visible "N selected"
  // count.
  it("never hands a bulk action an id absent from the current data", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DataTable {...base} bulkActions={[{ label: "Send email", onSelect }]} getRowId={(r) => r.id} />,
    );
    // Re-query between clicks rather than reusing a captured array: the
    // Checkbox's own re-render on each selection change is enough for
    // testing-library's node references to go stale.
    await userEvent.click(screen.getAllByLabelText("Select row")[0]); // selects id "1"
    await userEvent.click(screen.getAllByLabelText("Select row")[1]); // selects id "2"
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    // Row "1" drops out of view (e.g. a filter change) without any of
    // page/per/q/activeFilters literally changing on this particular
    // rerender — data alone changed. Row "2" is still present.
    rerender(
      <DataTable {...base} data={[rows[1]]} total={1}
        bulkActions={[{ label: "Send email", onSelect }]} getRowId={(r) => r.id} />,
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    // The seatbelt, pinned exactly: never "1" (stale, no longer visible),
    // only "2" (still present).
    expect(onSelect).toHaveBeenCalledWith(["2"]);
  });

  // I6 regression: rowHref must produce exactly one <a> per row (the first
  // data cell), not one per cell — a 6-column table must not become 150 tab
  // stops / 150 announced links for 25 destinations.
  it("renders exactly one link per row when rowHref is set, and the rest of the row still delegates to it", async () => {
    render(<DataTable {...base} rowHref={(r) => `/registrations/${r.id}`} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(rows.length);
    expect(links[0]).toHaveAttribute("href", "/registrations/1");

    // Clicking a non-link cell in the row (the Amount cell) should delegate
    // to that row's single anchor rather than doing nothing.
    const amountCell = screen.getByText("2850");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await userEvent.click(amountCell);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  // Regression for a bug found in review: firstDataColumnId was memoized on
  // `table`, whose identity never changes (useReactTable mutates a ref in
  // place), so the memo never recomputed after a column was hidden — the
  // row lost its anchor entirely and became a silent dead end. Toggling the
  // first data column off must not do that; the row must still expose
  // exactly one link, now wrapping whichever data column is first visible.
  it("keeps the row navigable when the first data column is hidden", async () => {
    render(<DataTable {...base} rowHref={(r) => `/registrations/${r.id}`} />);
    await userEvent.click(screen.getByLabelText("Toggle columns"));
    await userEvent.click(screen.getByLabelText("Name"));

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(rows.length);
    expect(links[0]).toHaveAttribute("href", "/registrations/1");
    expect(links[0]).toHaveTextContent("2850");
  });

  // Regression: a drag-select that ends (mouseup) over a non-link cell
  // still fires a click on the row. An admin copying an email or bib number
  // out of a cell must not get thrown to the detail page mid-copy.
  it("does not navigate when the click follows a text selection inside the row", () => {
    render(<DataTable {...base} rowHref={(r) => `/registrations/${r.id}`} />);
    const amountCell = screen.getByText("2850");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const getSelectionSpy = vi.spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "2850" } as unknown as Selection);

    fireEvent.click(amountCell);
    expect(clickSpy).not.toHaveBeenCalled();

    getSelectionSpy.mockRestore();
    clickSpy.mockRestore();
  });

  // Regression: a modifier click (cmd/ctrl/shift/alt) or non-primary button
  // on a non-link cell used to call `.click()` on the real anchor
  // programmatically, which drops the modifier and forces a same-tab
  // navigation — actively defeating "open in new tab", worse than doing
  // nothing. These must fall through and let the real anchor (which the
  // browser never even routes the click to here, since the click landed on
  // a non-link cell) handle it, i.e. do nothing from this handler's side.
  it("does not force a same-tab navigation on a modifier or non-primary click", () => {
    render(<DataTable {...base} rowHref={(r) => `/registrations/${r.id}`} />);
    const amountCell = screen.getByText("2850");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");

    fireEvent.click(amountCell, { ctrlKey: true });
    fireEvent.click(amountCell, { metaKey: true });
    fireEvent.click(amountCell, { shiftKey: true });
    fireEvent.click(amountCell, { altKey: true });
    fireEvent.click(amountCell, { button: 1 }); // middle click
    expect(clickSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });
});
