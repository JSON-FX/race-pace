import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventsTable } from "./events-table";
import type { AdminEventRow } from "@/lib/queries/events";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

beforeEach(() => {
  resetTableParamsSpies();
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
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    expect(screen.getByText("Dahilayan Sky Ultra")).toBeInTheDocument();
    expect(screen.getByText(/Manolo Fortich/)).toBeInTheDocument();
  });

  it("sums slots across categories", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    expect(screen.getByText("160 / 250")).toBeInTheDocument();
  });

  it("offers a create action from the empty state", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    expect(screen.getByText("No events yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an event/i })).toBeInTheDocument();
  });

  it("shows no-match copy (not the first-run copy) when a search is active", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{}} q="ultra" />);
    expect(screen.getByText("No events match")).toBeInTheDocument();
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  });

  it("shows no-match copy when a status filter is active", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{ status: "cancelled" }} q="" />);
    expect(screen.getByText("No events match")).toBeInTheDocument();
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  });

  it("links the row's primary anchor to the event editor route", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    // DataTable renders exactly one real <a> per row, in the first visible
    // data cell — assert against that anchor specifically, not every cell.
    const link = screen.getByRole("link", { name: /Dahilayan Sky Ultra/ });
    expect(link).toHaveAttribute("href", "/events/e1/edit");
  });
});
