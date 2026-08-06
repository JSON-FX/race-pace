// Must be the first import: vitest hoists `vi.mock`/`vi.hoisted` calls to the
// top of the module graph, and this module's `vi.hoisted` spies need to be
// established before anything else in this file is evaluated.
import { mockUseTableParams, tableParamsSpies, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";

mockUseTableParams();

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

const base: Pick<DataTableProps<Row>, "columns" | "data" | "total" | "page" | "per" | "sort" | "filterDefs" | "activeFilters"> = {
  columns, data: rows, total: 2, page: 1, per: 25,
  sort: [], filterDefs: [], activeFilters: {},
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
    expect(tableParamsSpies.patch).toHaveBeenCalledWith({ status: null, page: null });
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
});
