import { render, screen, fireEvent } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../components/DataTable";

type Row = { id: string; name: string; amount: number };
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Runner" },
  { accessorKey: "amount", header: "Amount" },
];
const rows: Row[] = [
  { id: "1", name: "Ana Cruz", amount: 100 },
  { id: "2", name: "Ben Diaz", amount: 200 },
];
const messages = { loading: "Loading…", empty: "Nothing here.", error: "Couldn't load." };

it("renders a real table with a header row and one row per record", () => {
  render(<DataTable columns={columns} data={rows} messages={messages} />);
  expect(screen.getByRole("columnheader", { name: "Runner" })).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
});

it("shows the loading message", () => {
  render(<DataTable columns={columns} data={[]} messages={messages} isLoading />);
  expect(screen.getByText("Loading…")).toBeInTheDocument();
});

it("shows the empty message", () => {
  render(<DataTable columns={columns} data={[]} messages={messages} />);
  expect(screen.getByText("Nothing here.")).toBeInTheDocument();
});

it("shows the error message and retries on click", () => {
  const onRetry = vi.fn();
  render(<DataTable columns={columns} data={[]} messages={messages} isError onRetry={onRetry} />);
  expect(screen.getByText("Couldn't load.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalled();
});

it("calls onRowClick with the clicked record", () => {
  const onRowClick = vi.fn();
  render(<DataTable columns={columns} data={rows} messages={messages} onRowClick={onRowClick} />);
  fireEvent.click(screen.getByText("Ben Diaz"));
  expect(onRowClick).toHaveBeenCalledWith(rows[1]);
});

it("pages client-side when no server config is given", () => {
  render(<DataTable columns={columns} data={rows} messages={messages} pageSize={1} />);
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.queryByText("Ben Diaz")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
});

it("delegates paging to the server config and reports the total", () => {
  const onPageChange = vi.fn();
  render(
    <DataTable
      columns={columns}
      data={rows}
      messages={messages}
      server={{ pageIndex: 1, pageCount: 5, totalRows: 97, onPageChange, sorting: [], onSortingChange: vi.fn() }}
    />
  );
  expect(screen.getByText("97 rows")).toBeInTheDocument();
  expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(onPageChange).toHaveBeenCalledWith(2);
});

it("reports header clicks through onSortingChange in server mode", () => {
  const onSortingChange = vi.fn();
  render(
    <DataTable
      columns={columns}
      data={rows}
      messages={messages}
      server={{ pageIndex: 0, pageCount: 1, totalRows: 2, onPageChange: vi.fn(), sorting: [], onSortingChange }}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Amount" }));
  expect(onSortingChange).toHaveBeenCalledWith([{ id: "amount", desc: false }]);
});

it("disables Previous on the first page and Next on the last", () => {
  render(
    <DataTable
      columns={columns}
      data={rows}
      messages={messages}
      server={{ pageIndex: 0, pageCount: 1, totalRows: 2, onPageChange: vi.fn(), sorting: [], onSortingChange: vi.fn() }}
    />
  );
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
});
