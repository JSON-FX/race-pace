import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EVENT_DISCIPLINES, DISCIPLINE_LABELS } from "@race-pace/shared";
import type { EditorData } from "@/lib/queries/event-editor";

vi.mock("@/lib/imageUpload", () => ({ uploadEventImage: vi.fn() }));
vi.mock("@/lib/psgc", () => ({
  usePsgcRegions: () => ({ data: [] }),
  usePsgcProvinces: () => ({ data: [], isSuccess: true }),
  usePsgcCities: () => ({ data: [] }),
  usePsgcCity: () => ({ data: null }),
}));

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh }) }));

// lib/actions/events.ts is a "use server" module (imports next/headers via
// lib/supabase/server) — mock it outright rather than spreading its actual
// exports. The form only imports saveEventAction as a value; the rest
// (CategoryDraft, AddonDraft, EventDraft, EditorState) are types and are
// erased at compile time, so they need no runtime re-export here.
const mockSaveEventAction = vi.fn().mockResolvedValue({ eventId: "e1" });
vi.mock("@/lib/actions/events", () => ({ saveEventAction: (prev: unknown, fd: FormData) => mockSaveEventAction(prev, fd) }));

// RouteEditor is loaded via next/dynamic({ ssr: false }) from the form so
// maplibre-gl (which reads `window` at module scope) never runs during SSR.
// None of these tests interact with the course locator, so stub the whole
// thing out rather than waiting on the dynamic import to resolve.
vi.mock("@/components/RouteEditor", () => ({ RouteEditor: () => <div data-testid="route-editor-stub" /> }));

import { EventEditorForm } from "./event-editor-form";

function lastSavedEvent() {
  const fd = mockSaveEventAction.mock.calls.at(-1)![1] as FormData;
  return JSON.parse(fd.get("payload") as string).event;
}

function editorData(overrides: Partial<EditorData["event"]> = {}): EditorData {
  return {
    event: {
      id: "e1", org_id: "a1", name: "Apo",
      city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
      event_date: null, end_date: null, flag_off: null, status: "open",
      discipline: "trail", elevation_gain_m: null, cutoff_hours: null, start_lat: null, start_lng: null,
      finish_lat: null, finish_lng: null, route: null, description: null, hero_image_url: null,
      gallery: [], schedule: [], inclusions: [],
      ...overrides,
    },
    categories: [],
    addons: [],
  };
}

beforeEach(() => {
  mockSaveEventAction.mockReset().mockResolvedValue({ eventId: "e1" });
  mockPush.mockClear();
  mockReplace.mockClear();
  mockRefresh.mockClear();
});

it("blocks save on an empty name, then saves a valid new event", async () => {
  render(<EventEditorForm initial={null} orgId="a1" />);
  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText(/Fix the event fields/)).toBeInTheDocument();
  expect(mockSaveEventAction).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent()).toMatchObject({ name: "Apo Sky Ultra", org_id: "a1", status: "draft" });
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/events"));
});

it("allows saving a cancelled event instead of dead-ending on the status validator", async () => {
  render(<EventEditorForm initial={editorData({ status: "cancelled" })} orgId="a1" />);
  fireEvent.click(await screen.findByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(screen.queryByText(/Fix the event fields/)).not.toBeInTheDocument();
  expect(lastSavedEvent()).toMatchObject({ id: "e1", name: "Apo", status: "cancelled" });
});

it("on a create-mode partial save, navigates to the edit route instead of leaving stale state that would duplicate a child on retry", async () => {
  mockSaveEventAction.mockResolvedValueOnce({ eventId: "e9", error: "Couldn't remove a category — it has registrations." });

  render(<EventEditorForm initial={null} orgId="a1" />);
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/events/e9/edit"));
  // Must not take the old full-success "/events" redirect on a partial failure.
  expect(mockPush).not.toHaveBeenCalledWith("/events");
});

it("on an edit-mode partial save, refreshes so the reseed effect reconciles child ids", async () => {
  mockSaveEventAction.mockResolvedValueOnce({ eventId: "e1", error: "Couldn't remove an add-on." });

  render(<EventEditorForm initial={editorData()} orgId="a1" />);
  fireEvent.click(await screen.findByText("Save event"));

  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(mockReplace).not.toHaveBeenCalled();
  expect(await screen.findByText("Couldn't remove an add-on.")).toBeInTheDocument();
});

it("carries hero_image_url + gallery through to save", async () => {
  render(<EventEditorForm initial={editorData({ hero_image_url: "https://cdn/hero.png", gallery: ["https://cdn/g1.png"] })} orgId="a1" />);
  // the images editor replaced the old hero-URL text field
  expect(await screen.findByText("Images")).toBeInTheDocument();
  expect(screen.queryByLabelText("Hero image URL")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent()).toMatchObject({
    hero_image_url: "https://cdn/hero.png",
    gallery: ["https://cdn/g1.png"],
  });
});

it("carries PSGC address + venue + date range through to save", async () => {
  render(<EventEditorForm initial={editorData({
    city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos", venue: "Camp Sabros",
    event_date: "2026-11-14", end_date: "2026-11-16", flag_off: "04:00",
  })} orgId="a1" />);
  expect(await screen.findByLabelText("Region")).toBeInTheDocument();
  expect(screen.getByLabelText("Venue")).toBeInTheDocument();
  expect((screen.getByLabelText("Date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("End date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-11-16");
  expect((screen.getByLabelText("Flag-off") as HTMLInputElement).type).toBe("time");
  expect(screen.queryByLabelText("Place")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent()).toMatchObject({
    city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos",
    venue: "Camp Sabros", event_date: "2026-11-14", end_date: "2026-11-16", flag_off: "04:00",
  });
});

it("blocks save when the end date is before the start date", async () => {
  render(<EventEditorForm initial={editorData({ event_date: "2026-11-14" })} orgId="a1" />);
  fireEvent.change(await screen.findByLabelText("End date"), { target: { value: "2026-11-10" } });
  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText("End date can't be before the start date.")).toBeInTheDocument();
  expect(mockSaveEventAction).not.toHaveBeenCalled();
});

it("offers all eight shared disciplines with their shared labels, and a chosen discipline round-trips through save", async () => {
  const user = userEvent.setup();
  render(<EventEditorForm initial={null} orgId="a1" />);

  await user.click(screen.getByLabelText("Discipline"));
  for (const d of EVENT_DISCIPLINES) {
    expect(await screen.findByRole("option", { name: DISCIPLINE_LABELS[d] })).toBeInTheDocument();
  }
  await user.click(screen.getByRole("option", { name: "Ultramarathon" }));

  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent()).toMatchObject({ discipline: "ultra" });
});

it("adds, edits, reorders, and removes schedule rows, saving the final order", async () => {
  render(<EventEditorForm initial={editorData()} orgId="a1" />);

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
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent().schedule).toEqual([
    { time: "04:30", label: "Gun start, 21K and 10K" },
    { time: "07:00", label: "Cut-off, 10K" },
  ]);

  fireEvent.click(screen.getAllByLabelText("Remove schedule row")[0]!);
  expect(screen.getAllByLabelText("Schedule time")).toHaveLength(1);
});

it("adds, edits, reorders, and removes inclusion rows, saving the final order", async () => {
  render(<EventEditorForm initial={editorData()} orgId="a1" />);

  const addButtons = await screen.findAllByText("+ Add");
  // EventImagesEditor, ScheduleEditor, InclusionsEditor, CategoryEditor, AddonEditor.
  fireEvent.click(addButtons[1]!);
  fireEvent.change(screen.getByLabelText("Inclusion"), { target: { value: "Six aid stations with hot food" } });

  fireEvent.click(screen.getAllByText("+ Add")[1]!);
  const lines = screen.getAllByLabelText("Inclusion");
  fireEvent.change(lines[1]!, { target: { value: "Race kit, bib, and timing chip" } });
  fireEvent.click(screen.getAllByLabelText("Move inclusion up")[1]!);

  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent().inclusions).toEqual([
    "Race kit, bib, and timing chip",
    "Six aid stations with hot food",
  ]);

  fireEvent.click(screen.getAllByLabelText("Remove inclusion")[0]!);
  expect(screen.getAllByLabelText("Inclusion")).toHaveLength(1);
});

it("a blank inclusion row left alongside a real one is dropped rather than saved as ''", async () => {
  render(<EventEditorForm initial={editorData({ inclusions: ["Finisher medal and summit certificate"] })} orgId="a1" />);

  // Leave a second, blank row alongside the existing one — it must not reach save as ''.
  const addButtons = await screen.findAllByText("+ Add");
  fireEvent.click(addButtons[1]!);
  fireEvent.change(screen.getAllByLabelText("Inclusion")[1]!, { target: { value: "   " } });

  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent().inclusions).toEqual(["Finisher medal and summit certificate"]);
});

it("removing every inclusion row persists an empty array rather than null", async () => {
  render(<EventEditorForm initial={editorData({ inclusions: ["Finisher medal and summit certificate"] })} orgId="a1" />);

  fireEvent.click(await screen.findByLabelText("Remove inclusion"));
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSaveEventAction).toHaveBeenCalled());
  expect(lastSavedEvent().inclusions).toEqual([]);
});

it("blocks save with a visible message when an inclusion line is over the length cap", async () => {
  render(<EventEditorForm initial={null} orgId="a1" />);
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });

  const addButtons = await screen.findAllByText("+ Add");
  fireEvent.click(addButtons[1]!);
  // Bypass the input's maxLength (fireEvent.change sets the DOM value directly)
  // so the over-length case actually reaches validation instead of native truncation.
  fireEvent.change(screen.getByLabelText("Inclusion"), { target: { value: "x".repeat(141) } });

  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText(/Fix the event fields/)).toBeInTheDocument();
  expect(mockSaveEventAction).not.toHaveBeenCalled();
});
