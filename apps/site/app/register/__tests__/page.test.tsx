import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser } }),
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
  vi.resetModules();
  redirect.mockClear();
  notFound.mockClear();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  fetchCategory.mockReset().mockResolvedValue(category);
  fetchAddons.mockReset().mockResolvedValue([]);
  fetchFormFields.mockReset().mockResolvedValue([]);
  fetchEvent.mockReset();
});

describe("RegisterPage", () => {
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
});
