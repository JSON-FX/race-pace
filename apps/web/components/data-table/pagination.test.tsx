import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTablePagination } from "./pagination";

function setup(over: Partial<React.ComponentProps<typeof DataTablePagination>> = {}) {
  const onPageChange = vi.fn();
  const onPerChange = vi.fn();
  render(
    <DataTablePagination
      page={3} per={25} total={791}
      onPageChange={onPageChange} onPerChange={onPerChange}
      {...over}
    />,
  );
  return { onPageChange, onPerChange };
}

describe("DataTablePagination", () => {
  it("shows the visible range and total", () => {
    setup();
    expect(screen.getByText("51–75 of 791")).toBeInTheDocument();
  });

  it("offers every page-size option", async () => {
    setup();
    await userEvent.click(screen.getByLabelText("Rows per page"));
    for (const n of [10, 25, 50, 100]) {
      expect(screen.getByRole("option", { name: String(n) })).toBeInTheDocument();
    }
  });

  it("disables Previous on the first page", () => {
    setup({ page: 1 });
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
  });

  it("disables Next on the last page", () => {
    setup({ page: 32 });
    expect(screen.getByLabelText("Next page")).toBeDisabled();
  });

  it("reports the requested page", async () => {
    const { onPageChange } = setup();
    await userEvent.click(screen.getByLabelText("Next page"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("renders nothing when there are no rows", () => {
    const { container } = render(
      <DataTablePagination page={1} per={25} total={0} onPageChange={vi.fn()} onPerChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
