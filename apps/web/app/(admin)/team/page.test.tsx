import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TeamPage from "./page";

const { listTeam, getMyRoles } = vi.hoisted(() => ({
  listTeam: vi.fn(() => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/team")>();
  return { ...actual, listTeam };
});

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("TeamPage", () => {
  it("renders NoOrgScope and never queries the team when the caller has no org", async () => {
    // A bare super_admin: isAdmin/isOrgAdmin true (clears the (admin)
    // layout guard) but orgId null — there's no organization to scope a
    // team query to. Querying with a null org id must not happen at all.
    getMyRoles.mockResolvedValue({ role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });

    const ui = await TeamPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listTeam).not.toHaveBeenCalled();
  });
});
