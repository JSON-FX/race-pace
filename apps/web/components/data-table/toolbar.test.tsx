import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTableToolbar } from "./toolbar";

function setup(over: Partial<React.ComponentProps<typeof DataTableToolbar>> = {}) {
  const onFilterChange = vi.fn();
  const onSearchChange = vi.fn();
  const utils = render(
    <DataTableToolbar
      filterDefs={[]} activeFilters={{}} q="" searchPlaceholder="Search…" columnToggles={[]}
      onFilterChange={onFilterChange} onSearchChange={onSearchChange}
      {...over}
    />,
  );
  return { onFilterChange, onSearchChange, ...utils };
}

describe("DataTableToolbar search box", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces typing and calls onSearchChange once, 300ms after the last keystroke", async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const { onSearchChange } = setup();
    await user.type(screen.getByLabelText("Search"), "maria");
    expect(onSearchChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith("maria");
  });

  // C1: the input used to be `useState(q)` initialised once and never
  // re-synced, so when the URL's q was cleared out from under the mounted
  // DataTable (chip removal, Back button, a filter reset), the input kept
  // showing stale text with no way to tell the admin the search no longer
  // applies.
  it("re-syncs the input when q changes externally (e.g. the search chip was removed)", () => {
    const { rerender } = setup({ q: "maria" });
    expect(screen.getByLabelText("Search")).toHaveValue("maria");

    rerender(
      <DataTableToolbar filterDefs={[]} activeFilters={{}} q="" searchPlaceholder="Search…" columnToggles={[]}
        onFilterChange={vi.fn()} onSearchChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("does not re-fire onSearchChange just because q changed externally (no feedback loop)", async () => {
    const { onSearchChange, rerender } = setup({ q: "maria" });
    rerender(
      <DataTableToolbar filterDefs={[]} activeFilters={{}} q="" searchPlaceholder="Search…" columnToggles={[]}
        onFilterChange={vi.fn()} onSearchChange={onSearchChange} />,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it("does not double-fire when the debounced value round-trips back in as the new q prop", async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const { onSearchChange, rerender } = setup();
    await user.type(screen.getByLabelText("Search"), "x");
    await vi.advanceTimersByTimeAsync(300);
    expect(onSearchChange).toHaveBeenCalledTimes(1);

    // The parent's URL state catches up and re-renders the toolbar with the
    // same value the debounce just sent.
    rerender(
      <DataTableToolbar filterDefs={[]} activeFilters={{}} q="x" searchPlaceholder="Search…" columnToggles={[]}
        onFilterChange={vi.fn()} onSearchChange={onSearchChange} />,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Search")).toHaveValue("x");
  });
});
