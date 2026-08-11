import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CategoryRow, AddonRow, FormFieldRow, EventRow } from "@/lib/events";
import { CheckoutError } from "@/lib/registration";
import { RegisterWizard } from "../RegisterWizard";

// Fix round: startCheckout used to throw a bare Error, discarding the
// registration_id registrations-checkout's already_registered 409 carries —
// so a runner who lost a race with another device/tab, or whose event-page
// gate was just stale, landed on a generic "Something went wrong" message and
// a dead-ended, completed three-step form instead of being routed to finish
// paying for the entry that already exists. Mirrors
// apps/mobile/app/register/[categoryId].tsx's handling of the same 409.
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace }) }));

const startCheckoutMock = vi.fn();
vi.mock("@/lib/registration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registration")>();
  return { ...actual, startCheckout: (...args: unknown[]) => startCheckoutMock(...args) };
});

vi.mock("@/lib/profile", () => ({
  getProfile: vi.fn().mockResolvedValue(null),
  upsertProfile: vi.fn().mockResolvedValue({}),
}));

const category: CategoryRow = {
  id: "cat1", event_id: "ev1", org_id: "org1", code: "21k", label: "21K",
  distance_km: 21, base_price: 150000, slots_total: 100, slots_taken: 10,
};
const event: EventRow = {
  id: "ev1", org_id: "org1", name: "Test Race", place: null, region: null,
  event_date: "2099-01-01", end_date: null, elevation_gain_m: null,
  cutoff_hours: null, status: "open", hero_image_url: null, description: null,
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null,
  city_name: null, venue: null, joined_count: 0, distances: [21],
  registration_closes_at: null,
};
const addons: AddonRow[] = [];
const formFields: FormFieldRow[] = [];

function renderWizard() {
  return render(
    <RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={formFields} />,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Bib name/), "Runner One");
  fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: "1990-01-01" } });
  await user.type(screen.getByLabelText(/Emergency contact/), "Mom · 0917 000 0000");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox"));
  await user.click(await screen.findByRole("button", { name: /^Register/ }));
}

beforeEach(() => {
  mockReplace.mockReset();
  startCheckoutMock.mockReset();
  window.sessionStorage.clear();
});

describe("RegisterWizard — already_registered 409", () => {
  it("routes straight to /pay/<id> instead of showing a dead-end error", async () => {
    startCheckoutMock.mockRejectedValue(new CheckoutError("already_registered", "existing-reg-1"));
    const user = userEvent.setup();
    renderWizard();

    await fillAndSubmit(user);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/pay/existing-reg-1"));
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it("falls back to readable copy — not the raw error code or a generic string — when the 409 body carried no registration_id", async () => {
    startCheckoutMock.mockRejectedValue(new CheckoutError("already_registered"));
    const user = userEvent.setup();
    renderWizard();

    await fillAndSubmit(user);

    expect(
      await screen.findByText("You're already entered in this race. Check My Races for your entry."),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
