import { render, screen, fireEvent } from "@testing-library/react-native";
import { FeaturedCarousel } from "../components/FeaturedCarousel";
import type { EventRow } from "../lib/events";

function makeEvent(id: string, name: string): EventRow {
  return {
    id, org_id: "o1", name, place: null, region: null, event_date: "2026-09-14", end_date: null,
    elevation_gain_m: null, cutoff_hours: null, status: "open", hero_image_url: null, description: null,
    gallery: [], original_date: null, status_note: null, city_psgc_code: null, region_name: null,
    province_name: null, city_name: null, venue: null, joined_count: 0, distances: [21],
    org_name: "TrailRun PH", org_color: "#3A7CC7",
  };
}

describe("FeaturedCarousel", () => {
  it("renders nothing when there are no featured events", () => {
    render(<FeaturedCarousel events={[]} onPressEvent={jest.fn()} />);
    expect(screen.queryByTestId("featured-carousel")).toBeNull();
  });

  it("renders one card per featured event and a pagination dot per event", () => {
    const events = [makeEvent("e1", "Masungi Trail Challenge"), makeEvent("e2", "Sagada Skyrace")];
    render(<FeaturedCarousel events={events} onPressEvent={jest.fn()} />);
    expect(screen.getByText("Masungi Trail Challenge")).toBeOnTheScreen();
    expect(screen.getByText("Sagada Skyrace")).toBeOnTheScreen();
    expect(screen.getByTestId("featured-dot-0")).toBeOnTheScreen();
    expect(screen.getByTestId("featured-dot-1")).toBeOnTheScreen();
  });

  it("hides pagination dots for a single featured event", () => {
    render(<FeaturedCarousel events={[makeEvent("e1", "Masungi Trail Challenge")]} onPressEvent={jest.fn()} />);
    expect(screen.queryByTestId("featured-dot-0")).toBeNull();
  });

  it("calls onPressEvent with the pressed event", () => {
    const onPressEvent = jest.fn();
    const events = [makeEvent("e1", "Masungi Trail Challenge")];
    render(<FeaturedCarousel events={events} onPressEvent={onPressEvent} />);
    fireEvent.press(screen.getByText("Masungi Trail Challenge"));
    expect(onPressEvent).toHaveBeenCalledWith(events[0]);
  });
});
