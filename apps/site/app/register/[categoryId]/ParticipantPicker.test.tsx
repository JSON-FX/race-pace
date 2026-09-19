import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CategoryRow, EventRow } from "@/lib/events";
import { ParticipantPicker, type ParticipantSummary } from "./ParticipantPicker";

const category: CategoryRow = {
  id: "category-5k",
  event_id: "event-1",
  org_id: "org-1",
  code: "5k",
  label: "5K Pilot Run",
  distance_km: 5,
  base_price: 10000,
  slots_total: 50,
  slots_taken: 3,
};

const event = {
  id: "event-1",
  name: "Mindanao Sunrise Run",
} as EventRow;

const participants: ParticipantSummary[] = [
  { id: "self", claimed_user_id: "user-1", first_name: "Jayson", last_name: "Runner" },
  { id: "guest", claimed_user_id: null, first_name: "Maria", last_name: "Runner" },
  { id: "other", claimed_user_id: "user-2", first_name: "Hidden", last_name: "Runner" },
];

function renderPicker(groupCheckoutEnabled = false, items = participants) {
  return render(
    <ParticipantPicker
      category={category}
      event={event}
      participants={items}
      userId="user-1"
      groupCheckoutEnabled={groupCheckoutEnabled}
    />,
  );
}

describe("ParticipantPicker", () => {
  it("presents the signed-in runner and managed passports as full participant choices", () => {
    renderPicker();

    expect(screen.getByRole("heading", { name: "Who is joining?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Register myself/ })).toHaveAttribute(
      "href",
      "/register/category-5k?participant=self",
    );
    expect(screen.getByRole("link", { name: /Maria Runner/ })).toHaveAttribute(
      "href",
      "/register/category-5k?participant=guest",
    );
    expect(screen.queryByText("Hidden Runner")).not.toBeInTheDocument();
  });

  it("keeps participant management actions visible and correctly linked", () => {
    renderPicker();

    expect(screen.getByRole("link", { name: /Create or complete a Race Passport/ })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: /Bookings I manage/ })).toHaveAttribute("href", "/bookings");
    expect(screen.getByRole("link", { name: /Back to event/ })).toHaveAttribute("href", "/events/event-1");
  });

  it("shows group checkout only when its release flag is enabled", () => {
    const { rerender } = renderPicker(false);
    expect(screen.queryByRole("link", { name: /Register several participants/ })).not.toBeInTheDocument();

    rerender(
      <ParticipantPicker
        category={category}
        event={event}
        participants={participants}
        userId="user-1"
        groupCheckoutEnabled
      />,
    );
    expect(screen.getByRole("link", { name: /Register several participants/ })).toHaveAttribute(
      "href",
      "/register/category-5k/group",
    );
  });

  it("provides a helpful empty state when no eligible passports exist", () => {
    renderPicker(false, [participants[2]!]);

    expect(screen.getByRole("status")).toHaveTextContent("No complete Race Passports are ready yet.");
    expect(screen.getByRole("link", { name: /Create or complete a Race Passport/ })).toBeInTheDocument();
  });
});
