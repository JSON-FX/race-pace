import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import EventsPage from "./page";
import type { AdminEventRow } from "@/lib/queries/events";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

// EventsTable renders a <DataTable>, which calls Next's router hooks — mock
// the same way every other DataTable-rendering test in this app does.
vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

const { listOrgEvents, getMyRoles } = vi.hoisted(() => ({
  // Explicit return-type annotation, not inference: an arrow function whose
  // body is only `throw` infers `never`, which then rejects a later
  // `.mockResolvedValue(...)`/`.mockRejectedValue(...)` call with "not
  // assignable to parameter of type 'never'".
  listOrgEvents: vi.fn((): Promise<{ rows: AdminEventRow[]; total: number }> => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/events")>("@/lib/queries/events");
  return { ...actual, listOrgEvents };
});

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("EventsPage", () => {
  beforeEach(() => {
    resetTableParamsSpies();
    listOrgEvents.mockClear();
  });

  it("renders NoOrgScope and never queries events when the caller has no org", async () => {
    getMyRoles.mockResolvedValue({
      role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"],
    });

    const ui = await EventsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgEvents).not.toHaveBeenCalled();
  });

  // Fix 2 regression test: only organizations/commission/payouts/team
  // asserted a capability before this fix — every manage_org route (Events
  // included) was reachable by a marshal typing the URL directly, past the
  // (admin) layout's "some capability" gate.
  it("redirects a marshal to /no-access and never queries events", async () => {
    getMyRoles.mockResolvedValue({
      role: "marshal", orgId: "org-1", isSuperAdmin: false, isAdmin: false, isOrgAdmin: false,
      capabilities: ["check_in"],
    });

    await expect(EventsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(listOrgEvents).not.toHaveBeenCalled();
  });

  it("renders the events table on the happy path", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEvents.mockResolvedValue({
      rows: [{
        id: "e1", name: "Dahilayan Sky Ultra", place: null, city_name: null, province_name: null,
        event_date: "2026-11-14", end_date: null, status: "open", original_date: null, categories: [],
      }],
      total: 1,
    });

    const ui = await EventsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("Dahilayan Sky Ultra")).toBeInTheDocument();
  });

  // Regression coverage for the (admin) error.tsx / isError wiring: before
  // this, listOrgEvents throwing had no page-level catch anywhere, so a
  // transient DB blip would only ever be caught by Next's route-segment
  // error.tsx — losing the header, count text and "New event" button along
  // with the table. Catching it here means those keep working and only the
  // table area degrades.
  it("keeps the header and 'New event' button usable, and shows a retryable table error, when listOrgEvents throws", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEvents.mockRejectedValue(new Error("connection reset"));

    const ui = await EventsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new event/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/connection reset/)).not.toBeInTheDocument();
  });
});
