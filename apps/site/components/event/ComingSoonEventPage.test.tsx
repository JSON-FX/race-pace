import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ComingSoonEventPage } from "./ComingSoonEventPage";
import type { CategoryRow, EventRow } from "@/lib/events";
import type { RunnerPassport } from "@/lib/passports";

const { from, invoke } = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from, functions: { invoke } }) }));

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

const pricedCategory = {
  id: "category", event_id: event.id, org_id: event.org_id, code: "70k", label: "70K Ultra Trail",
  distance_km: 70, base_price: 350000, slots_total: 100, slots_taken: 0,
  reservation_enabled: false, reservation_fee_cents: 20000,
  reservation_sales_close_at: "2027-10-15T15:59:00Z",
  prescreening_enabled: false, prescreening_requirement: "Finish a 50 km race.",
} satisfies CategoryRow;

describe("ComingSoonEventPage category registration fees", () => {
  it.each([
    ["plain", false, false],
    ["screening only", false, true],
    ["reservation", true, false],
    ["screened reservation", true, true],
  ])("shows the entry price for a %s category independently of its reservation fee", (_, reservation, screening) => {
    render(<ComingSoonEventPage event={event} userEmail={null} reservation={null}
      categories={[{ ...pricedCategory, reservation_enabled: reservation, prescreening_enabled: screening }]} />);
    const article = within(screen.getByRole("article"));
    expect(article.getByText("Registration fee")).toBeInTheDocument();
    expect(article.getByText("₱3,500.00")).toBeInTheDocument();
    if (reservation) {
      expect(article.getByText(/Reservation fee: ₱200.00/)).toBeInTheDocument();
      expect(article.getByRole("link", { name: screening ? "Request reservation review" : "Reserve for ₱200.00" }))
        .toHaveAttribute("href", `/prescreening/new?event=${event.id}&category=${pricedCategory.id}&intent=reservation`);
    } else {
      expect(article.getByText(/Reservations are not available/)).toBeInTheDocument();
    }
  });

  it("keeps each registration amount with its own category", () => {
    render(<ComingSoonEventPage event={event} userEmail={null} reservation={null}
      categories={[pricedCategory, { ...pricedCategory, id: "42k", label: "42K Trail", base_price: 275050 }]} />);
    const articles = screen.getAllByRole("article");
    expect(within(articles[0]).getByText("₱3,500.00")).toBeInTheDocument();
    expect(within(articles[0]).queryByText("₱2,750.50")).not.toBeInTheDocument();
    expect(within(articles[1]).getByText("₱2,750.50")).toBeInTheDocument();
  });

  it("omits zero/default prices without presenting a free registration", () => {
    render(<ComingSoonEventPage event={event} userEmail={null} reservation={null}
      categories={[{ ...pricedCategory, base_price: 0 }]} />);
    const article = within(screen.getByRole("article"));
    expect(article.queryByText("Registration fee")).not.toBeInTheDocument();
    expect(article.queryByText("₱0.00")).not.toBeInTheDocument();
    expect(article.getByText(/Registration opens soon/)).toBeInTheDocument();
  });
});

describe("ComingSoonEventPage Passport selection", () => {
  it("routes new requests through category admission while preserving an older paid reservation", () => {
    const category = {
      id: "category", event_id: event.id, org_id: event.org_id, code: "70k", label: "70K Ultra Trail",
      distance_km: 70, base_price: 350000, slots_total: 100, slots_taken: 0,
      reservation_enabled: false, prescreening_enabled: true, prescreening_requirement: "Finish a 50 km race.",
    } satisfies CategoryRow;
    const page = render(<ComingSoonEventPage event={event} userEmail="runner@example.test" reservation={null} categories={[category]} />);
    expect(screen.getByText("Finish a 50 km race.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "RESERVE YOUR PLACE" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reserve now" })).not.toBeInTheDocument();
    page.rerender(<ComingSoonEventPage event={event} userEmail="runner@example.test"
      reservation={{ id: "older", status: "paid", quantity: 1 }} categories={[category]} />);
    expect(screen.getByRole("heading", { name: "RESERVE YOUR PLACE" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View reservation" })).toHaveAttribute("href", "/reservations/older");
  });
  it.each([
    ["expired", false],
    ["pending", true],
    ["review_required", true],
  ])("uses a safe idempotency key when the prior reservation is %s", async (status, reuseKey) => {
    const oldKey = "00000000-0000-4000-8000-000000000001";
    sessionStorage.setItem("coming-soon-reservation:event:own", oldKey);
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: { status }, error: null })) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    from.mockReturnValue(query);
    invoke.mockResolvedValue({ data: { error: "event_capacity_exhausted" }, error: null });
    render(<ComingSoonEventPage event={event} userEmail="runner@example.test" reservation={null} />);
    await screen.findByRole("checkbox", { name: /E2E Runner/ });
    fireEvent.click(screen.getByRole("button", { name: "Reserve now" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    if (reuseKey) expect(invoke.mock.calls[0][1].body.idempotency_key).toBe(oldKey);
    else expect(invoke.mock.calls[0][1].body.idempotency_key).not.toBe(oldKey);
    expect(sessionStorage.getItem("coming-soon-reservation:event:own"))
      .toBe(invoke.mock.calls[0][1].body.idempotency_key);
    sessionStorage.clear();
    from.mockReset();
    invoke.mockReset();
  });
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
