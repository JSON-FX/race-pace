import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventBody } from "../EventBody";
import type { EventRow, CategoryRow } from "@/lib/events";

const baseEvent: EventRow = {
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
  { id: "c-100", event_id: "e1", org_id: "a1", code: "100K", label: "100K", distance_km: 100, base_price: 250000, slots_total: 200, slots_taken: 40, elevation_gain_m: 4200, cutoff_hours: 20, blurb: null },
  { id: "c-50", event_id: "e1", org_id: "a1", code: "50K", label: "50K", distance_km: 50, base_price: 150000, slots_total: 100, slots_taken: 100, elevation_gain_m: 2400, cutoff_hours: 12, blurb: null },
];

describe("EventBody — profile discipline (trail)", () => {
  it("renders the elevation profile signature, not the route ribbon", () => {
    render(<EventBody event={baseEvent} categories={categories} closed={false} />);
    expect(screen.getByRole("img", { name: /elevation profile/i })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /illustrative route/i })).not.toBeInTheDocument();
  });

  it("renders the profile signature for ultra too — the bug that hardcoding === 'trail' would cause", () => {
    render(<EventBody event={{ ...baseEvent, discipline: "ultra" }} categories={categories} closed={false} />);
    expect(screen.getByRole("img", { name: /elevation profile/i })).toBeInTheDocument();
  });

  it("does not present a sold-out category as enterable", () => {
    render(<EventBody event={baseEvent} categories={categories} closed={false} />);
    expect(screen.queryByRole("link", { name: /Enter — ₱1,500.00/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Sold out").length).toBeGreaterThan(0);
  });

  it("omits the race-facts grid cells for null category/event fields rather than rendering 0 or —", () => {
    const noFacts: EventRow = { ...baseEvent, elevation_gain_m: null, cutoff_hours: null, flag_off: null };
    render(<EventBody event={noFacts} categories={categories} closed={false} />);
    expect(screen.queryByText("Total climb")).not.toBeInTheDocument();
    expect(screen.queryByText("Cut-off")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    // "Registered" is real data (0 or more people), not a missing fact — it
    // still renders even when everything else is null.
    expect(screen.getByText("Registered")).toBeInTheDocument();
  });

  it("omits per-category facts (gain/cut-off) that are null without printing 0", () => {
    const nullCats: CategoryRow[] = [
      { id: "c1", event_id: "e1", org_id: "a1", code: "10K", label: "10K", distance_km: 10, base_price: 50000, slots_total: 50, slots_taken: 2, elevation_gain_m: null, cutoff_hours: null, blurb: null },
    ];
    render(<EventBody event={baseEvent} categories={nullCats} closed={false} />);
    expect(screen.queryByText(/0 m gain/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 h cut-off/)).not.toBeInTheDocument();
  });
});

describe("EventBody — route discipline (fun_run)", () => {
  const funRunEvent: EventRow = {
    ...baseEvent,
    discipline: "fun_run",
    elevation_gain_m: null,
    cutoff_hours: null,
  };
  const routeCategories: CategoryRow[] = [
    { id: "c-3", event_id: "e1", org_id: "a1", code: "3K", label: "3K", distance_km: 3, base_price: 60000, slots_total: 300, slots_taken: 10, elevation_gain_m: null, cutoff_hours: null, blurb: "Kids, families, and first-timers." },
    { id: "c-10", event_id: "e1", org_id: "a1", code: "10K", label: "10K", distance_km: 10, base_price: 100000, slots_total: 60, slots_taken: 55, elevation_gain_m: null, cutoff_hours: null, blurb: null },
  ];

  it("renders the route ribbon signature, not the elevation profile", () => {
    render(<EventBody event={funRunEvent} categories={routeCategories} closed={false} />);
    expect(screen.getByRole("img", { name: /illustrative route/i })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /elevation profile/i })).not.toBeInTheDocument();
  });

  it("renders distances as cards with a Join CTA", () => {
    render(<EventBody event={funRunEvent} categories={routeCategories} closed={false} />);
    expect(screen.getAllByRole("link", { name: "Join" }).length).toBe(2);
  });

  it("omits the blurb paragraph text when a category has none, without a placeholder", () => {
    render(<EventBody event={funRunEvent} categories={routeCategories} closed={false} />);
    expect(screen.getByText("Kids, families, and first-timers.")).toBeInTheDocument();
  });

  it("shows a low-slots flag only for the category that is actually low, data-driven not fabricated", () => {
    render(<EventBody event={funRunEvent} categories={routeCategories} closed={false} />);
    // 10K has 5 of 60 slots left (<=15) — flagged. 3K has 290 left — not.
    expect(screen.getByText("5 slots left")).toBeInTheDocument();
  });

  it("omits the whole schedule section when schedule is empty", () => {
    render(<EventBody event={funRunEvent} categories={routeCategories} closed={false} />);
    expect(screen.queryByText("Race morning")).not.toBeInTheDocument();
  });

  it("renders the schedule section when populated", () => {
    const withSchedule: EventRow = { ...funRunEvent, schedule: [{ time: "04:30", label: "Gun start, 21K and 10K" }] };
    render(<EventBody event={withSchedule} categories={routeCategories} closed={false} />);
    expect(screen.getByText("Race morning")).toBeInTheDocument();
    expect(screen.getByText("Gun start, 21K and 10K")).toBeInTheDocument();
    expect(screen.getByText("04:30")).toBeInTheDocument();
  });

  it("does not present a sold-out category as enterable and shows no Join link for it", () => {
    const soldOutCats: CategoryRow[] = [
      { id: "c-sold", event_id: "e1", org_id: "a1", code: "21K", label: "21K", distance_km: 21, base_price: 150000, slots_total: 40, slots_taken: 40, elevation_gain_m: null, cutoff_hours: null, blurb: null },
    ];
    render(<EventBody event={funRunEvent} categories={soldOutCats} closed={false} />);
    expect(screen.queryByRole("link", { name: "Join" })).not.toBeInTheDocument();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  it("shows a closed state instead of Join once registration is closed", () => {
    render(<EventBody event={funRunEvent} categories={routeCategories} closed={true} />);
    expect(screen.queryByRole("link", { name: "Join" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
  });
});

describe("EventBody — falls back to profile when discipline is missing/unknown", () => {
  it("treats a missing discipline as profile, matching disciplineLayout()'s own default", () => {
    const noDiscipline: EventRow = { ...baseEvent, discipline: undefined };
    render(<EventBody event={noDiscipline} categories={categories} closed={false} />);
    expect(screen.getByRole("img", { name: /elevation profile/i })).toBeInTheDocument();
  });
});
