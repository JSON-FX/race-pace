import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ComingSoonEventPage } from "./ComingSoonEventPage";
import type { EventRow } from "@/lib/events";
import type { RunnerPassport } from "@/lib/passports";

vi.mock("@/lib/passports", () => ({ listPassports: vi.fn(async () => [
  { id: "own", claimed_user_id: "runner", first_name: "E2E", last_name: "Runner" },
  { id: "managed", claimed_user_id: null, first_name: "E2E", last_name: "Companion" },
] as RunnerPassport[]) }));

const event = {
  id: "event", org_id: "org", name: "Highland Traverse", slug: "highland-traverse", status: "coming_soon",
  place: null, region: null, event_date: null, end_date: null, elevation_gain_m: null,
  cutoff_hours: null, description: "Coming soon", gallery: [], hero_image_url: null,
  original_date: null, status_note: null, city_psgc_code: null, region_name: null,
  province_name: null, city_name: null, venue: null, joined_count: 0, distances: [],
  registration_closes_at: null,
  coming_soon_reserve_enabled: true, reservation_fee_cents: 50000,
  reservation_platform_fee_cents: 1500, reservation_deadline_at: "2027-10-15T15:59:00Z",
} satisfies EventRow;

describe("ComingSoonEventPage Passport selection", () => {
  it("defaults to the runner only and changes the fee when a managed Passport is selected", async () => {
    render(<ComingSoonEventPage event={event} userEmail="runner@example.test" reservation={null} />);
    const own = await screen.findByRole("checkbox", { name: /E2E Runner/ });
    const managed = screen.getByRole("checkbox", { name: /E2E Companion/ });
    expect(own).toBeChecked();
    expect(managed).not.toBeChecked();
    expect(screen.getByText("Your Passport starts selected. Leave managed Passports unchecked to reserve only for yourself. Each selected Passport adds one event place and one reservation fee.")).toBeInTheDocument();
    expect(screen.getByText("₱500.00")).toBeInTheDocument();

    fireEvent.click(managed);
    await waitFor(() => expect(screen.getByText("RESERVATION FEE × 2 Passports")).toBeInTheDocument());
    expect(screen.getByText("₱1,000.00")).toBeInTheDocument();
    fireEvent.click(managed);
    expect(managed).not.toBeChecked();
    expect(screen.getByText("₱500.00")).toBeInTheDocument();
  });

  it("names the Passports on an existing two-place reservation", () => {
    render(<ComingSoonEventPage event={event} userEmail="runner@example.test"
      reservation={{ id: "reservation", status: "paid", quantity: 2 }}
      reservedPassports={[
        { participant_name: "E2E Runner", is_managed: false },
        { participant_name: "E2E Companion", is_managed: true },
      ]} />);
    expect(screen.getByRole("heading", { name: "2 reserved event places" })).toBeInTheDocument();
    expect(screen.getByText("E2E Runner")).toBeInTheDocument();
    expect(screen.getByText("E2E Companion")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Choose who to reserve for" })).not.toBeInTheDocument();
  });
});
