import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CategoryRow, EventRow } from "@/lib/events";
import { ScreeningRequest } from "./request-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/prescreening/ProofUpload", () => ({ ProofUpload: () => null }));

const event = { id: "event", name: "North Ridge", slug: "north-ridge" } as EventRow;
const category = { id: "21k", event_id: "event", org_id: "org", code: "21k", label: "21K",
  distance_km: 21, base_price: 150000, slots_total: 100, slots_taken: 0,
  reservation_enabled: true, reservation_available: 5, general_available: 80,
  reservation_sales_close_at: "2099-01-01T00:00:00Z", inclusions: [] } satisfies CategoryRow;
const passports = [{ id: "runner", claimed_user_id: "user", first_name: "Mika", last_name: "Reyes" }];

describe("category request form", () => {
  it("explains immediate readiness when the selected category needs no review", () => {
    render(<ScreeningRequest event={event} categories={[category]} initialCategory={category.id}
      intent="reservation" passports={passports} userId="user"
      initialParticipants={[{ passportId: "runner", categoryId: category.id }]} />);
    expect(screen.getByRole("heading", { name: "Reserve places" })).toBeInTheDocument();
    expect(screen.getByText("Pay after submission")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit and hold 1 slot" })).toBeEnabled();
  });

  it("blocks a request when the selected reservation pool is full", () => {
    render(<ScreeningRequest event={event} categories={[{ ...category, reservation_available: 0 }]}
      initialCategory={category.id} intent="reservation" passports={passports} userId="user"
      initialParticipants={[{ passportId: "runner", categoryId: category.id }]} />);
    expect(screen.getByRole("button", { name: "Submit and hold 1 slot" })).toBeDisabled();
    expect(screen.getByText(/no available reservation slots/)).toBeInTheDocument();
  });
});
