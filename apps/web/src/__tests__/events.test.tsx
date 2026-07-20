import { render, screen } from "@testing-library/react";
import { Events } from "../routes/Events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
let mockQuery: { data?: unknown[]; isLoading: boolean; isError: boolean; refetch: () => void };
vi.mock("../lib/events", async (orig) => ({ ...(await orig()), useOrgEvents: () => mockQuery }));

it("renders a row per event with category count + fill", () => {
  mockQuery = { isLoading: false, isError: false, refetch: () => {}, data: [
    { id: "e1", name: "Apo Sky Ultra", event_date: "2026-11-14", status: "open", original_date: null,
      categories: [{ slots_taken: 3, slots_total: 10 }, { slots_taken: 1, slots_total: 5 }] },
  ] };
  render(<Events />);
  expect(screen.getByText("Apo Sky Ultra")).toBeInTheDocument();
  expect(screen.getByText("4/15")).toBeInTheDocument();  // fill summed across categories
});

it("shows the empty state when there are no events", () => {
  mockQuery = { isLoading: false, isError: false, refetch: () => {}, data: [] };
  render(<Events />);
  expect(screen.getByText("No events yet.")).toBeInTheDocument();
});

it("shows the loading state", () => {
  mockQuery = { isLoading: true, isError: false, refetch: () => {}, data: undefined };
  render(<Events />);
  expect(screen.getByText("Loading events…")).toBeInTheDocument();
});
