import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CategoryRow, EventRow } from "@/lib/events";

// Server component: mock its Next.js primitives + data layer directly rather
// than rendering, since redirect()/notFound() throw and never return.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ redirect, notFound }));

const getUser = vi.fn();
const passportResult = vi.fn();
const passportQuery = { select: () => passportQuery, eq: () => passportQuery, maybeSingle: () => passportResult() };
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser }, from: () => passportQuery }),
}));

const fetchCategory = vi.fn();
const fetchEvent = vi.fn();
const fetchAddons = vi.fn();
const fetchFormFields = vi.fn();
vi.mock("@/lib/events", () => ({
  fetchCategory: (...a: unknown[]) => fetchCategory(...a),
  fetchEvent: (...a: unknown[]) => fetchEvent(...a),
  fetchAddons: (...a: unknown[]) => fetchAddons(...a),
  fetchFormFields: (...a: unknown[]) => fetchFormFields(...a),
}));

const fetchMyEntry = vi.fn();
vi.mock("@/lib/entry", () => ({
  fetchMyEntry: (...a: unknown[]) => fetchMyEntry(...a),
}));

vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("../[categoryId]/RegisterWizard", () => ({ RegisterWizard: () => null }));

const category: CategoryRow = {
  id: "c1", event_id: "e1", org_id: "a1", code: "100k", label: "100K",
  distance_km: 100, base_price: 250000, slots_total: 100, slots_taken: 10,
};

async function loadPage() {
  const mod = await import("../[categoryId]/page");
  return mod.default;
}

beforeEach(() => {
  passportResult.mockResolvedValue({ data: { first_name: "QA", last_name: "Runner", date_of_birth: "1950-01-01", gender: "Female", contact_number: "09171234567", emergency_contact_name: "QA Contact", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "House 1, Sample Street" }, error: null });
  vi.resetModules();
  redirect.mockClear();
  notFound.mockClear();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  fetchCategory.mockReset().mockResolvedValue(category);
  fetchAddons.mockReset().mockResolvedValue([]);
  fetchFormFields.mockReset().mockResolvedValue([]);
  fetchEvent.mockReset();
  fetchMyEntry.mockReset().mockResolvedValue(null);
});

describe("RegisterPage", () => {
  it("stops a legacy open event without an organizer waiver before showing checkout", async () => {
    fetchEvent.mockResolvedValue({ id: "e1", status: "open", waiver_version_id: null } as EventRow);
    const Page = await loadPage();
    render(await Page({ params: Promise.resolve({ categoryId: "c1" }) }));
    expect(screen.getByRole("heading", { name: "Registration is temporarily unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/organizer needs to publish an event waiver/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Register/ })).not.toBeInTheDocument();
  });

  it("shows the Passport completion gate instead of the wizard for missing details", async () => {
    fetchEvent.mockResolvedValue({ id: "e1", status: "open" } as EventRow);
    passportResult.mockResolvedValue({ data: null, error: null });
    const Page = await loadPage();
    render(await Page({ params: Promise.resolve({ categoryId: "c1" }) }));
    expect(screen.getByRole("heading", { name: "Complete your Race Passport" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Race Passport" })).toHaveAttribute("href", "/profile");
  });
  it("redirects away from a cancelled event instead of rendering the wizard", async () => {
    fetchEvent.mockResolvedValue({ id: "e1", status: "cancelled" } as EventRow);
    const RegisterPage = await loadPage();

    await expect(RegisterPage({ params: Promise.resolve({ categoryId: "c1" }) })).rejects.toThrow(
      "REDIRECT:/events/e1?closed=c1",
    );
  });

  it("redirects away from a closed event", async () => {
    fetchEvent.mockResolvedValue({ id: "e1", status: "closed" } as EventRow);
    const RegisterPage = await loadPage();

    await expect(RegisterPage({ params: Promise.resolve({ categoryId: "c1" }) })).rejects.toThrow(
      "REDIRECT:/events/e1?closed=c1",
    );
  });

  it("still lets an almost_full event through to the sold-out slot check", async () => {
    fetchEvent.mockResolvedValue({ id: "e1", status: "almost_full" } as EventRow);
    const RegisterPage = await loadPage();

    // slots_taken (10) < slots_total (100), so neither redirect fires and the
    // page proceeds to render the wizard.
    const result = await RegisterPage({ params: Promise.resolve({ categoryId: "c1" }) });
    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  it("redirects to the event page when the runner already holds a live entry — even on a different distance", async () => {
    // Authoritative check is registrations-checkout's 409; this is the same
    // don't-walk-them-into-a-wall reasoning as the closed/sold-out redirects
    // above, just for the one-entry-per-event rule instead.
    fetchEvent.mockResolvedValue({ id: "e1", status: "open" } as EventRow);
    fetchMyEntry.mockResolvedValue({ id: "r9", status: "paid", categoryId: "some-other-category", expiresAt: null });
    const RegisterPage = await loadPage();

    await expect(RegisterPage({ params: Promise.resolve({ categoryId: "c1" }) })).rejects.toThrow(
      "REDIRECT:/events/e1?registered=r9",
    );
  });

  it("does not redirect when the runner holds no live entry", async () => {
    fetchEvent.mockResolvedValue({ id: "e1", status: "open" } as EventRow);
    fetchMyEntry.mockResolvedValue(null);
    const RegisterPage = await loadPage();

    const result = await RegisterPage({ params: Promise.resolve({ categoryId: "c1" }) });
    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
