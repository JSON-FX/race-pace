import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RegistrationsPage from "./page";

const { listEventRegistrations, listOrgEventOptions, listEventCategories, getMyRoles } = vi.hoisted(() => ({
  listEventRegistrations: vi.fn(() => {
    throw new Error("must not be called");
  }),
  listOrgEventOptions: vi.fn(() => {
    throw new Error("must not be called");
  }),
  listEventCategories: vi.fn(() => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/registrations", () => ({
  listEventRegistrations,
  listOrgEventOptions,
  listEventCategories,
}));

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("RegistrationsPage", () => {
  it("renders NoOrgScope and never queries registrations when the caller has no org", async () => {
    // A bare super_admin: isAdmin true (clears the (admin) layout guard) but
    // orgId null — there's no organization to scope a registrations query
    // to. Querying with a null org id 500s rather than returning an empty
    // list, so the page must branch before calling any query at all.
    getMyRoles.mockResolvedValue({ role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgEventOptions).not.toHaveBeenCalled();
    expect(listEventRegistrations).not.toHaveBeenCalled();
    expect(listEventCategories).not.toHaveBeenCalled();
  });
});
