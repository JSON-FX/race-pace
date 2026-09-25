import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrganizerProfileOpenSpread } from "../TrailAtlas";
import type { Organizer } from "@/lib/organizers";

vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <img src={String(props.src)} alt={String(props.alt ?? "")} /> }));

const organizer: Organizer = {
  id: "org-1", slug: "ridge-river", name: "Ridge & River Collective",
  logoUrl: null, bannerUrl: "https://example.test/promo-banner.png", featuredImageUrl: null,
  description: "Trail days in Bukidnon.", homeCity: null, homeProvince: null, homeRegion: null, homeBase: null,
  raceTypes: [], events: [],
};

it("renders a text-led hero without using the promotional cover", () => {
  const { container } = render(<OrganizerProfileOpenSpread organizer={organizer} />);
  expect(screen.getByRole("heading", { name: "Ridge & River Collective" })).toBeInTheDocument();
  expect(container.querySelector(".trail-atlas__hero-photo")).toBeNull();
  expect(container.querySelector(".trail-atlas__profile-hero--text-only")).not.toBeNull();
});

it("renders only the admin-chosen featured photograph in Open spread", () => {
  const { container } = render(<OrganizerProfileOpenSpread organizer={{ ...organizer, featuredImageUrl: "https://example.test/featured.png" }} />);
  expect(container.querySelector(".trail-atlas__hero-photo img")).toHaveAttribute("src", "https://example.test/featured.png");
  expect(container.querySelector(".trail-atlas__profile-hero--text-only")).toBeNull();
});
