import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventEditor } from "../routes/EventEditor";
import type { EditorData } from "../lib/events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
const mockUseEventForEditor = vi.fn<() => { data: EditorData | null; isLoading: boolean }>(() => ({ data: null, isLoading: false }));
vi.mock("../lib/events", () => ({ useEventForEditor: () => mockUseEventForEditor() }));
const mockSave = vi.fn().mockResolvedValue({ eventId: "e1", childErrors: [] });
vi.mock("../lib/eventWrites", async (orig) => ({ ...(await orig()), saveEvent: (a: unknown) => mockSave(a) }));
const mockNav = vi.fn();
const mockUseParams = vi.fn(() => ({}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => mockNav, useParams: () => mockUseParams() }));
// EventEditor() now calls useQueryClient directly (partial-save reseed on the edit-mode
// path), so it needs a QueryClient ancestor — stub it, same pattern as events.test.tsx.
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

beforeEach(() => {
  mockUseParams.mockReturnValue({});
  mockUseEventForEditor.mockReturnValue({ data: null, isLoading: false });
  mockSave.mockClear();
  mockNav.mockClear();
});

it("blocks save on an empty name, then saves a valid new event", async () => {
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText(/Fix the event fields/)).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({ name: "Apo Sky Ultra", org_id: "a1", status: "draft" });
});

it("allows saving a cancelled event instead of dead-ending on the status validator", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo Sky Ultra", place: null, region: null,
        event_date: null, flag_off: null, status: "cancelled",
        elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null,
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });

  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(screen.queryByText(/Fix the event fields/)).not.toBeInTheDocument();
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({ id: "e1", name: "Apo Sky Ultra", status: "cancelled" });
});

it("on a create-mode partial save, navigates to the edit route instead of leaving stale state that would duplicate a child on retry", async () => {
  mockUseParams.mockReturnValue({});
  mockSave.mockResolvedValueOnce({ eventId: "e9", childErrors: ["Couldn't remove a category — it has registrations."] });

  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));

  await waitFor(() => expect(mockNav).toHaveBeenCalledWith(
    "/events/e9/edit",
    { replace: true, state: { childErrors: ["Couldn't remove a category — it has registrations."] } }
  ));
  // Must not take the old "/events" success redirect on a partial failure.
  expect(mockNav).not.toHaveBeenCalledWith("/events");
});
