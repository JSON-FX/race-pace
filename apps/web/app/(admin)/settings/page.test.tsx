import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsPage from "./page";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ refresh: vi.fn() }) };
});

const { getOrg, getMyRoles, getWaiverVersions, getEventWaiverSettings } = vi.hoisted(() => ({
  getOrg: vi.fn(async (_orgId: string): Promise<{
    id: string;
    name: string;
    logo_url: string | null;
    banner_url: string | null;
    check_in_required_default: boolean;
  }> => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
  getWaiverVersions: vi.fn(),
  getEventWaiverSettings: vi.fn(),
}));

vi.mock("@/lib/queries/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/org")>();
  return { ...actual, getOrg };
});

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

vi.mock("@/lib/queries/waivers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/waivers")>();
  return { ...actual, getWaiverVersions, getEventWaiverSettings };
});

describe("SettingsPage", () => {
  it("renders NoOrgScope and never queries the org when the caller has no org", async () => {
    // A bare super_admin: isAdmin/isOrgAdmin true (clears the (admin) layout
    // guard) but orgId null — there's no organization to scope a query to.
    // Querying with a null org id must not happen at all.
    getMyRoles.mockResolvedValue({
      role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"],
    });

    const ui = await SettingsPage();
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(getOrg).not.toHaveBeenCalled();
  });

  // Fix 2 regression test: Settings asserted no capability before this fix,
  // so a marshal (check_in only, no manage_org) reached a fully rendered
  // page past the (admin) layout's "some capability" gate.
  it("redirects a marshal to /no-access and never queries the org", async () => {
    getMyRoles.mockResolvedValue({
      role: "marshal", orgId: "org-1", isSuperAdmin: false, isAdmin: false, isOrgAdmin: false,
      capabilities: ["check_in"],
    });

    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(getOrg).not.toHaveBeenCalled();
  });

  it("renders the approved Brand Studio with the organization identity", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_org"],
    });
    getOrg.mockResolvedValue({
      id: "org-1", name: "Yalabyalam Trail Runners", logo_url: null, banner_url: null,
      check_in_required_default: true,
    });
    getWaiverVersions.mockResolvedValue([]);
    getEventWaiverSettings.mockResolvedValue([]);

    const ui = await SettingsPage();
    render(ui);

    expect(screen.getByRole("heading", { name: "Organization settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Public organization identity preview")).toHaveTextContent("Yalabyalam Trail Runners");
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
    expect(screen.getByText("Admin access")).toBeInTheDocument();
  });
});
