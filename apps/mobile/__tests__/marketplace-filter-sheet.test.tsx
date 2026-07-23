import { render, screen, fireEvent } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";
import { MarketplaceFilterSheet } from "../components/MarketplaceFilterSheet";
import { DEFAULT_MARKETPLACE_FILTERS } from "../lib/marketplaceFilters";
import type { EventRow, OrgRow } from "../lib/events";

const TODAY = "2026-07-23";

const events: EventRow[] = [
  {
    id: "e1", org_id: "o1", name: "Rizal Ridge Ultra", place: null, region: null,
    event_date: "2026-08-01", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
    hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
    city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
    joined_count: 0, distances: [21], org_name: "TrailRun PH", org_color: "#3A7CC7",
  },
  {
    id: "e2", org_id: "o2", name: "Batangas Coastal 50", place: null, region: null,
    event_date: "2026-08-05", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
    hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
    city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
    joined_count: 0, distances: [50], org_name: "Endure PH", org_color: "#C7473A",
  },
];

const orgs: OrgRow[] = [
  { id: "o1", name: "TrailRun PH", slug: "trailrun-ph", logo_url: null, banner_url: null, description: null, brand_color: "#3A7CC7", event_count: 1 },
  { id: "o2", name: "Endure PH", slug: "endure-ph", logo_url: null, banner_url: null, description: null, brand_color: "#C7473A", event_count: 1 },
];

function renderSheet(props: Partial<React.ComponentProps<typeof MarketplaceFilterSheet>> = {}) {
  const onOpenChange = jest.fn();
  const onApply = jest.fn();
  render(
    <>
      <MarketplaceFilterSheet
        open
        onOpenChange={onOpenChange}
        filters={DEFAULT_MARKETPLACE_FILTERS}
        onApply={onApply}
        allEvents={events}
        orgs={orgs}
        todayIso={TODAY}
        {...props}
      />
      <PortalHost />
    </>
  );
  return { onOpenChange, onApply };
}

describe("MarketplaceFilterSheet", () => {
  it("shows a live match count that narrows as distance filters are picked", () => {
    renderSheet();
    expect(screen.getByText("Show 2 events")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("21K"));
    expect(screen.getByText("Show 1 event")).toBeOnTheScreen();
  });

  it("applies the draft selection and closes on Apply", () => {
    const { onApply, onOpenChange } = renderSheet();
    fireEvent.press(screen.getByText("21K"));
    fireEvent.press(screen.getByText("Show 1 event"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ distanceBuckets: ["21k"] }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("discards the draft and closes on Cancel", () => {
    const { onApply, onOpenChange } = renderSheet();
    fireEvent.press(screen.getByText("21K"));
    fireEvent.press(screen.getByText("Cancel"));
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigates into the Organizer picker and back", async () => {
    renderSheet();
    fireEvent.press(screen.getByText("All organizers"));
    expect(await screen.findByPlaceholderText("Search organizers")).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText("Back"));
    expect(screen.getByText("All organizers")).toBeOnTheScreen();
  });

  it("resets distance/region/organizer but keeps the date segment when applied", () => {
    const { onApply } = renderSheet({ filters: { ...DEFAULT_MARKETPLACE_FILTERS, dateSegment: "week", distanceBuckets: ["21k"] } });
    expect(screen.getByRole("checkbox", { name: "21K", checked: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Reset"));
    expect(screen.getByRole("checkbox", { name: "21K", checked: false })).toBeOnTheScreen();
    fireEvent.press(screen.getByText(/Show \d+ events?/));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ dateSegment: "week", distanceBuckets: [] }));
  });
});
