import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventBody } from "@/components/EventBody";
import type { EventRow, CategoryRow } from "@/lib/events";

// ParallaxMedia attaches scroll/IntersectionObserver listeners; jsdom has no
// IntersectionObserver, and the motion is irrelevant to what these assert.
vi.mock("@/components/ParallaxMedia", () => ({
  ParallaxMedia: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const base = {
  id: "e1", org_id: "a1", name: "Apo Sky Ultra 2026", place: null, region: null,
  event_date: "2026-11-14", end_date: null, elevation_gain_m: 4200, cutoff_hours: 20,
  status: "open", hero_image_url: null, description: null, gallery: [],
  original_date: null, status_note: null, city_psgc_code: null, region_name: null,
  province_name: null, city_name: null, venue: null, inclusions: null,
  joined_count: 0, distances: [100], org_name: null, org_color: null, org_logo_url: null,
  schedule: [{ time: "03:00", label: "Gun start, 100K and 50K" }],
} as unknown as EventRow;

const categories: CategoryRow[] = [];

describe("EventBody — schedule visibility", () => {
  // Regression: the admin offers the schedule editor for all eight disciplines,
  // but the site only published it on `route` layouts. A trail organizer could
  // save a full timeline and have it silently go nowhere.
  it("publishes the schedule on a TRAIL (profile-layout) event", () => {
    render(<EventBody event={{ ...base, discipline: "trail" } as EventRow} categories={categories} closed={false} />);
    expect(screen.getByText("Gun start, 100K and 50K")).toBeInTheDocument();
  });

  it("publishes the schedule on a ROAD (route-layout) event", () => {
    render(<EventBody event={{ ...base, discipline: "fun_run" } as EventRow} categories={categories} closed={false} />);
    expect(screen.getByText("Gun start, 100K and 50K")).toBeInTheDocument();
  });

  it("omits the section entirely when the schedule is empty — the default state", () => {
    render(<EventBody event={{ ...base, discipline: "trail", schedule: [] } as unknown as EventRow} categories={categories} closed={false} />);
    expect(screen.queryByText(/Race morning/i)).not.toBeInTheDocument();
  });
});
