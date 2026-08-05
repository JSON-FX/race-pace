import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SingleEventLanding } from "../SingleEventLanding";
import type { EventRow, CategoryRow } from "@/lib/events";

const event: EventRow = {
  id: "e1", org_id: "a1", name: "Apo Sky Ultra 2026", place: "Mt Apo", region: "Davao",
  event_date: "2026-11-14", end_date: null, elevation_gain_m: 4200, cutoff_hours: 20,
  status: "open", hero_image_url: null, description: "A brutal climb through cloud forest.",
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: "Davao Region", province_name: "Davao Del Sur",
  city_name: "City of Digos", venue: "Kapatagan Base Camp", inclusions: ["Finisher medal", "Race singlet"],
  joined_count: 47, distances: [100, 50], org_name: "Race Pace", org_color: "#159A55", org_logo_url: null,
  discipline: "trail", schedule: [],
};

const categories: CategoryRow[] = [
  { id: "c-100", event_id: "e1", org_id: "a1", code: "100K", label: "100K", distance_km: 100, base_price: 250000, slots_total: 200, slots_taken: 40 },
  { id: "c-50", event_id: "e1", org_id: "a1", code: "50K", label: "50K", distance_km: 50, base_price: 150000, slots_total: 100, slots_taken: 100 },
];

describe("SingleEventLanding", () => {
  it("renders every distance with its formatted price and a link to /register/<id>", () => {
    render(<SingleEventLanding event={event} categories={categories} />);
    const link = screen.getByRole("link", { name: /Enter — ₱2,500.00/ });
    expect(link).toHaveAttribute("href", "/register/c-100");
  });

  it("does not present a sold-out category as enterable", () => {
    render(<SingleEventLanding event={event} categories={categories} />);
    expect(screen.queryByRole("link", { name: /Enter — ₱1,500.00/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Sold out").length).toBeGreaterThan(0);
  });

  it("renders without a hero_image_url — the fallback path that actually ships", () => {
    const { container } = render(<SingleEventLanding event={event} categories={categories} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
  });

  it("shows what's included when inclusions are populated", () => {
    render(<SingleEventLanding event={event} categories={categories} />);
    expect(screen.getByText("Finisher medal")).toBeInTheDocument();
  });

  it("does not manufacture urgency when slots are plentiful and status is open", () => {
    const plenty: CategoryRow[] = [
      { id: "c-1", event_id: "e1", org_id: "a1", code: "10K", label: "10K", distance_km: 10, base_price: 50000, slots_total: 200, slots_taken: 2 },
    ];
    render(<SingleEventLanding event={{ ...event, status: "open" }} categories={plenty} />);
    expect(screen.queryByText(/^Only \d+ slots? left$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Almost full")).not.toBeInTheDocument();
  });

  it("shows the almost_full badge when the event status says so", () => {
    render(<SingleEventLanding event={{ ...event, status: "almost_full" }} categories={categories} />);
    expect(screen.getByText("Almost full")).toBeInTheDocument();
  });

  it("shows registration closed instead of an entry link once the event is closed", () => {
    render(<SingleEventLanding event={{ ...event, status: "closed" }} categories={categories} />);
    expect(screen.queryByRole("link", { name: /Enter —/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Registration closed").length).toBeGreaterThan(0);
  });
});
