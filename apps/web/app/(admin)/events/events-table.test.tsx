import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventsTable } from "./events-table";
import type { AdminEventRow } from "@/lib/queries/events";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

const mockCancel = vi.fn().mockResolvedValue({});
const mockReschedule = vi.fn().mockResolvedValue({});
vi.mock("@/lib/actions/events", () => ({
  cancelEventAction: (id: string, note: string) => mockCancel(id, note),
  rescheduleEventAction: (id: string, currentDate: string | null, currentEndDate: string | null, newDate: string, note: string) =>
    mockReschedule(id, currentDate, currentEndDate, newDate, note),
}));

beforeEach(() => {
  resetTableParamsSpies();
  mockCancel.mockClear();
  mockReschedule.mockClear();
});

const rows: AdminEventRow[] = [
  {
    id: "e1", name: "Dahilayan Sky Ultra", place: "Dahilayan", city_name: "Manolo Fortich",
    province_name: "Bukidnon", event_date: "2026-11-14", end_date: null, status: "published",
    original_date: null, categories: [{ slots_taken: 120, slots_total: 200 }, { slots_taken: 40, slots_total: 50 }],
  },
];

describe("EventsTable", () => {
  it("shows the event name and location", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
    expect(screen.getByText("Dahilayan Sky Ultra")).toBeInTheDocument();
    expect(screen.getByText(/Manolo Fortich/)).toBeInTheDocument();
  });

  it("sums slots across categories", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
    expect(screen.getByText("160 / 250")).toBeInTheDocument();
  });

  it("offers a create action from the empty state", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
    expect(screen.getByText("No events yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an event/i })).toBeInTheDocument();
  });

  it("shows no-match copy (not the first-run copy) when a search is active", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{}} q="ultra" canWrite />);
    expect(screen.getByText("No events match")).toBeInTheDocument();
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  });

  it("shows no-match copy when a status filter is active", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{ status: "cancelled" }} q="" canWrite />);
    expect(screen.getByText("No events match")).toBeInTheDocument();
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  });

  it("links the row's primary anchor to the event editor route", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
    // DataTable renders exactly one real <a> per row, in the first visible
    // data cell — assert against that anchor specifically, not every cell.
    const link = screen.getByRole("link", { name: /Dahilayan Sky Ultra/ });
    expect(link).toHaveAttribute("href", "/events/e1/edit");
  });

  describe("row actions menu", () => {
    it("offers Edit, Reschedule and Cancel event when the caller can write", async () => {
      const user = userEvent.setup();
      render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
      await user.click(screen.getByRole("button", { name: /actions for dahilayan sky ultra/i }));
      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Reschedule" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Cancel event" })).toBeInTheDocument();
    });

    it("is not offered to a caller who cannot write events", () => {
      render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite={false} />);
      expect(screen.queryByRole("button", { name: /actions for/i })).not.toBeInTheDocument();
    });

    it("opens the cancel confirm modal and calls cancelEventAction", async () => {
      const user = userEvent.setup();
      render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
      await user.click(screen.getByRole("button", { name: /actions for dahilayan sky ultra/i }));
      await user.click(screen.getByRole("menuitem", { name: "Cancel event" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/Cancel “Dahilayan Sky Ultra”/)).toBeInTheDocument();
      await user.click(within(dialog).getByText("Cancel event"));
      await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("e1", ""));
    });

    it("opens the reschedule modal and calls rescheduleEventAction", async () => {
      const user = userEvent.setup();
      render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
      await user.click(screen.getByRole("button", { name: /actions for dahilayan sky ultra/i }));
      await user.click(screen.getByRole("menuitem", { name: "Reschedule" }));

      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("New date"), "2026-12-01");
      await user.click(within(dialog).getByText("Reschedule"));
      await waitFor(() =>
        expect(mockReschedule).toHaveBeenCalledWith("e1", "2026-11-14", null, "2026-12-01", ""),
      );
    });

    it("clicking the actions trigger does not navigate the row", async () => {
      const user = userEvent.setup();
      render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" canWrite />);
      await user.click(screen.getByRole("button", { name: /actions for dahilayan sky ultra/i }));
      // The menu opened (not a navigation) — its items are now in the document.
      expect(screen.getByRole("menuitem", { name: "Cancel event" })).toBeInTheDocument();
    });
  });
});
