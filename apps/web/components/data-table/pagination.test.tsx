import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTablePagination, pageWindow } from "./pagination";

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

// Common invariants any pageWindow() result must satisfy, regardless of
// page/pageCount — used across the boundary tests below instead of hand
// re-deriving them per case.
function assertWellFormed(w: (number | null)[], page: number, pageCount: number) {
  // No two nulls (ellipsis gaps) back to back — a gap of one page isn't a
  // gap, it should just be the page number.
  for (let i = 1; i < w.length; i++) {
    expect(!(w[i] === null && w[i - 1] === null)).toBe(true);
  }
  // No duplicate page numbers.
  const nums = w.filter((n): n is number => n !== null);
  expect(new Set(nums).size).toBe(nums.length);
  // First and last page are always present, and the current page is always
  // present.
  expect(nums[0]).toBe(1);
  expect(nums[nums.length - 1]).toBe(pageCount);
  expect(nums).toContain(page);
}

describe("pageWindow", () => {
  it("lists every page when pageCount is 1 (single page)", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it("lists every page with no ellipsis when pageCount is exactly 7 (the collapse boundary)", () => {
    const w = pageWindow(4, 7);
    expect(w).toEqual([1, 2, 3, 4, 5, 6, 7]);
    assertWellFormed(w, 4, 7);
  });

  it("starts collapsing once pageCount is 8 (one past the boundary)", () => {
    const w = pageWindow(4, 8);
    expect(w).toContain(null);
    assertWellFormed(w, 4, 8);
  });

  it("has no leading gap when the current page is 1", () => {
    const w = pageWindow(1, 32);
    // page 1, its neighbour, then a single gap before the last page.
    expect(w[0]).toBe(1);
    expect(w.filter((n) => n === null)).toHaveLength(1);
    assertWellFormed(w, 1, 32);
  });

  it("has no leading gap when the current page is 2 (start > 2 is false)", () => {
    const w = pageWindow(2, 32);
    expect(w.indexOf(null)).not.toBe(1); // no gap right after page 1
    assertWellFormed(w, 2, 32);
  });

  it("has both a leading and trailing gap in the middle of a long run", () => {
    const w = pageWindow(16, 32);
    expect(w.filter((n) => n === null)).toHaveLength(2);
    assertWellFormed(w, 16, 32);
  });

  it("has no trailing gap when the current page is pageCount - 1", () => {
    const w = pageWindow(31, 32);
    assertWellFormed(w, 31, 32);
    expect(w.filter((n) => n === null)).toHaveLength(1);
  });

  it("has no trailing gap when the current page is the last page", () => {
    const w = pageWindow(32, 32);
    assertWellFormed(w, 32, 32);
    expect(w.filter((n) => n === null)).toHaveLength(1);
    expect(w[w.length - 1]).toBe(32);
  });
});
