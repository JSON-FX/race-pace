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

  // The org-members edge function 403s a non-org-admin's list call before
  // it ever reaches the "list" branch (its caller-is-admin check runs
  // first), so an editor calling listTeam would 500, not get a read-only
  // list. This is the regression MINOR 4 flags: if TeamPage's gate were
  // ever loosened from `roles.isOrgAdmin` to `roles.isAdmin` (which an
  // editor also satisfies), this test fails — it would let an editor
  // through to a listTeam call that this suite has told to throw.
  it("renders an org-admins-only notice and never queries the team for an editor (isAdmin but not isOrgAdmin)", async () => {
    getMyRoles.mockResolvedValue({ role: "editor", orgId: "a1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: false });

    const ui = await TeamPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("Organization admins only")).toBeInTheDocument();
    expect(listTeam).not.toHaveBeenCalled();
  });
});
