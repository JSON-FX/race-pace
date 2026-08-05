import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventCard } from "../EventCard";
import type { EventRow } from "@/lib/events";

const event: EventRow = {
  id: "e1", org_id: "a1", name: "Apo Sky Ultra 2026", place: "Mt Apo", region: "Davao",
  event_date: "2026-11-14", end_date: null, elevation_gain_m: 4200, cutoff_hours: 20,
  status: "open", hero_image_url: null, description: "The flagship 100K.",
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: "Davao Region", province_name: "Davao Del Sur",
  city_name: "City of Digos", venue: "Kapatagan Base Camp",
  joined_count: 47, distances: [100, 50], org_name: "Race Pace", org_color: "#159A55", org_logo_url: null,
};

describe("EventCard", () => {
  it("shows the event name and organizer", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
    expect(screen.getByText("Race Pace")).toBeInTheDocument();
  });

  it("shows every distance as a chip", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("100K")).toBeInTheDocument();
    expect(screen.getByText("50K")).toBeInTheDocument();
  });

  it("shows the formatted date and location", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("14 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("City of Digos, Davao Del Sur")).toBeInTheDocument();
  });

  it("links to the event page", () => {
    render(<EventCard event={event} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/events/e1");
  });

  it("flags a cancelled event so it cannot be mistaken for open", () => {
    render(<EventCard event={{ ...event, status: "cancelled" }} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("renders an event with no date or location without crashing", () => {
    render(<EventCard event={{ ...event, event_date: null, city_name: null, province_name: null }} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
  });

  it.each([
    ["almost_full", "Almost full"],
    ["closed", "Closed"],
    ["completed", "Completed"],
  ])("humanizes status %s as %s in the badge", (status, label) => {
    render(<EventCard event={{ ...event, status }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
