import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizerDirectory } from "../OrganizerDirectory";
import type { Organizer } from "@/lib/organizers";

vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <img src={String(props.src)} alt={String(props.alt ?? "")} /> }));

const organizers: Organizer[] = [
  { id: "1", slug: "north", name: "Northern Crew", logoUrl: null, bannerUrl: null, featuredImageUrl: null, description: "Bukidnon trail days", homeCity: "Malaybalay", homeProvince: "Bukidnon", homeRegion: "Northern Mindanao", homeBase: "Malaybalay, Bukidnon", raceTypes: [], events: [] },
  { id: "2", slug: "south", name: "Southern Crew", logoUrl: null, bannerUrl: null, featuredImageUrl: null, description: null, homeCity: null, homeProvince: null, homeRegion: "Davao Region", homeBase: null, raceTypes: [], events: [] },
];

it("filters organizers by live regions and search, then clears both filters", async () => {
  const user = userEvent.setup();
  render(<OrganizerDirectory organizers={organizers} />);
  expect(screen.getByText("2 organizers shown")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Davao Region" }));
  expect(screen.getByText("1 organizer shown")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Northern Crew" })).not.toBeInTheDocument();
  await user.type(screen.getByRole("searchbox", { name: "Search organizers or places" }), "Bukidnon");
  expect(screen.getByRole("heading", { name: "No organizers found" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("2 organizers shown")).toBeInTheDocument();
});
