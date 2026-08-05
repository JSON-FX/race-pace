import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EVENT_DISCIPLINES, DISCIPLINE_LABELS } from "@race-pace/shared";
import { EventEditor } from "../routes/EventEditor";
import type { EditorData } from "../lib/events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/imageUpload", () => ({ uploadEventImage: vi.fn() }));
vi.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: [] }),
  usePsgcProvinces: () => ({ data: [], isSuccess: true }),
  usePsgcCities: () => ({ data: [] }),
  usePsgcCity: () => ({ data: null }),
}));
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
        id: "e1", org_id: "a1", name: "Apo Sky Ultra",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "cancelled",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
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

it("carries hero_image_url + gallery through to save", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "open", discipline: "trail",
        elevation_gain_m: null, cutoff_hours: null, description: null,
        hero_image_url: "https://cdn/hero.png", gallery: ["https://cdn/g1.png"], schedule: [], inclusions: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  // the images editor replaced the old hero-URL text field
  expect(await screen.findByText("Images")).toBeInTheDocument();
  expect(screen.queryByLabelText("Hero image URL")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({
    hero_image_url: "https://cdn/hero.png",
    gallery: ["https://cdn/g1.png"],
  });
});

it("carries PSGC address + venue + date range through to save", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos", venue: "Camp Sabros",
        event_date: "2026-11-14", end_date: "2026-11-16", flag_off: "04:00", status: "open",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  expect(await screen.findByLabelText("Region")).toBeInTheDocument();
  expect(screen.getByLabelText("Venue")).toBeInTheDocument();
  expect((screen.getByLabelText("Date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("End date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-11-16");
  expect((screen.getByLabelText("Flag-off") as HTMLInputElement).type).toBe("time");
  expect(screen.queryByLabelText("Place")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({
    city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos",
    venue: "Camp Sabros", event_date: "2026-11-14", end_date: "2026-11-16", flag_off: "04:00",
  });
});

it("blocks save when the end date is before the start date", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: "2026-11-14", end_date: null, flag_off: null, status: "open",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("End date"), { target: { value: "2026-11-10" } });
  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText("End date can't be before the start date.")).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});

it("offers all eight shared disciplines with their shared labels, and a chosen discipline round-trips through save", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><EventEditor /></MemoryRouter>);

  await user.click(screen.getByLabelText("Discipline"));
  for (const d of EVENT_DISCIPLINES) {
    expect(await screen.findByRole("option", { name: DISCIPLINE_LABELS[d] })).toBeInTheDocument();
  }
  await user.click(screen.getByRole("option", { name: "Ultramarathon" }));

  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({ discipline: "ultra" });
});

it("adds, edits, reorders, and removes schedule rows, saving the final order", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "open",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);

  // The event details / images / schedule / categories / add-ons sections each
  // render their own "+ Add" control — the schedule editor's is the first one
  // in DOM order (EventImagesEditor, ScheduleEditor, CategoryEditor, AddonEditor).
  const scheduleAdd = (await screen.findAllByText("+ Add"))[0]!;
  fireEvent.click(scheduleAdd);
  fireEvent.change(screen.getByLabelText("Schedule time"), { target: { value: "07:00" } });
  fireEvent.change(screen.getByLabelText("Schedule label"), { target: { value: "Cut-off, 10K" } });

  // add a second row that should end up first once we move it up
  fireEvent.click(screen.getAllByText("+ Add")[0]!);
  const times = screen.getAllByLabelText("Schedule time");
  const labels = screen.getAllByLabelText("Schedule label");
  fireEvent.change(times[1]!, { target: { value: "04:30" } });
  fireEvent.change(labels[1]!, { target: { value: "Gun start, 21K and 10K" } });
  fireEvent.click(screen.getAllByLabelText("Move row up")[1]!);

  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event.schedule).toEqual([
    { time: "04:30", label: "Gun start, 21K and 10K" },
    { time: "07:00", label: "Cut-off, 10K" },
  ]);

  fireEvent.click(screen.getAllByLabelText("Remove schedule row")[0]!);
  expect(screen.getAllByLabelText("Schedule time")).toHaveLength(1);
});

it("adds, edits, reorders, and removes inclusion rows, saving the final order", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "open",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);

  const addButtons = await screen.findAllByText("+ Add");
  // EventImagesEditor, ScheduleEditor, InclusionsEditor, CategoryEditor, AddonEditor.
  fireEvent.click(addButtons[1]!);
  fireEvent.change(screen.getByLabelText("Inclusion"), { target: { value: "Six aid stations with hot food" } });

  fireEvent.click(screen.getAllByText("+ Add")[1]!);
  const lines = screen.getAllByLabelText("Inclusion");
  fireEvent.change(lines[1]!, { target: { value: "Race kit, bib, and timing chip" } });
  fireEvent.click(screen.getAllByLabelText("Move inclusion up")[1]!);

  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event.inclusions).toEqual([
    "Race kit, bib, and timing chip",
    "Six aid stations with hot food",
  ]);

  fireEvent.click(screen.getAllByLabelText("Remove inclusion")[0]!);
  expect(screen.getAllByLabelText("Inclusion")).toHaveLength(1);
});

it("a blank inclusion row left alongside a real one is dropped rather than saved as ''", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "open",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [],
        inclusions: ["Finisher medal and summit certificate"],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);

  // Leave a second, blank row alongside the existing one — it must not reach save as ''.
  const addButtons = await screen.findAllByText("+ Add");
  fireEvent.click(addButtons[1]!);
  fireEvent.change(screen.getAllByLabelText("Inclusion")[1]!, { target: { value: "   " } });

  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event.inclusions).toEqual(["Finisher medal and summit certificate"]);
});

it("removing every inclusion row persists an empty array rather than null", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "open",
        discipline: "trail", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [], schedule: [],
        inclusions: ["Finisher medal and summit certificate"],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);

  fireEvent.click(await screen.findByLabelText("Remove inclusion"));
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event.inclusions).toEqual([]);
});

it("blocks save with a visible message when an inclusion line is over the length cap", async () => {
  mockUseParams.mockReturnValue({});
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });

  const addButtons = await screen.findAllByText("+ Add");
  fireEvent.click(addButtons[1]!);
  // Bypass the input's maxLength (fireEvent.change sets the DOM value directly)
  // so the over-length case actually reaches validation instead of native truncation.
  fireEvent.change(screen.getByLabelText("Inclusion"), { target: { value: "x".repeat(141) } });

  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText(/Fix the event fields/)).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});
