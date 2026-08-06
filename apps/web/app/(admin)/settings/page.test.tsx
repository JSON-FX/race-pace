import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsPage from "./page";

const { getOrg, getMyRoles } = vi.hoisted(() => ({
  getOrg: vi.fn(() => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/org")>();
  return { ...actual, getOrg };
});

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("SettingsPage", () => {
  it("renders NoOrgScope and never queries the org when the caller has no org", async () => {
    // A bare super_admin: isAdmin/isOrgAdmin true (clears the (admin) layout
    // guard) but orgId null — there's no organization to scope a query to.
    // Querying with a null org id must not happen at all.
    getMyRoles.mockResolvedValue({ role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });

    const ui = await SettingsPage();
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(getOrg).not.toHaveBeenCalled();
  });
});
