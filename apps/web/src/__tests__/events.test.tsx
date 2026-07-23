import { render, screen, fireEvent } from "@testing-library/react";
import { Events } from "../routes/Events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
let mockQuery: { data?: unknown[]; isLoading: boolean; isError: boolean; refetch: () => void };
vi.mock("../lib/events", async (orig) => ({ ...(await orig()), useOrgEvents: () => mockQuery }));
vi.mock("../lib/registrations", () => ({ useEventRegistrationCounts: () => ({ data: {} }) }));
// Events() now calls useNavigate/useQueryClient directly (row actions + "+ Create event"),
// so it needs a Router + QueryClient ancestor — stub both, same pattern as event-editor.test.tsx.
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

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

it("shows the error state and retries on click", () => {
  const refetchSpy = vi.fn();
  mockQuery = { isLoading: false, isError: true, refetch: refetchSpy, data: undefined };
  render(<Events />);
  expect(screen.getByText("Couldn't load events.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Retry"));
  expect(refetchSpy).toHaveBeenCalled();
});

it("shows a date range when end_date is set, and a single date otherwise", () => {
  mockQuery = { isLoading: false, isError: false, refetch: () => {}, data: [
    { id: "e1", name: "Apo Sky Ultra", event_date: "2026-11-14", end_date: "2026-11-16", status: "open", original_date: null, categories: [] },
    { id: "e2", name: "Single Day Race", event_date: "2026-10-01", end_date: null, status: "open", original_date: null, categories: [] },
  ] };
  render(<Events />);
  expect(screen.getByText("Nov 14, 2026 – Nov 16, 2026")).toBeInTheDocument();
  expect(screen.getByText("Oct 1, 2026")).toBeInTheDocument();
});
