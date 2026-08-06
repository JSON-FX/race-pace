import { render, screen } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { MyRoles } from "@/lib/queries/roles";

vi.mock("next/navigation", () => ({ usePathname: () => "/events" }));
vi.mock("@/lib/actions/auth", () => ({ signOutAction: vi.fn() }));

import { Sidebar } from "./Sidebar";

function roles(overrides: Partial<MyRoles> = {}): MyRoles {
  return { role: "admin", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true, orgId: "a1", ...overrides };
}

function renderSidebar(r: MyRoles) {
  return render(
    <SidebarProvider>
      <Sidebar
        roles={r}
        email="admin@racepace.test"
        orgName="Race Pace Events"
        counts={{ events: 12, registrations: 847 }}
      />
    </SidebarProvider>,
  );
}

// Team is gated on isOrgAdmin, not on the (admin) layout's coarser isAdmin
// guard — an editor (isAdmin: true, isOrgAdmin: false) can reach every other
// org-scoped page but must not see a Team link, since Team's own page/action
// gate (lib/actions/team.ts) is admin-only. Sidebar.tsx:78's
// `it.to !== "/team" || roles.isOrgAdmin` is the only thing enforcing that
// in the UI; this test exists so a refactor that inverts or drops it fails
// loudly instead of silently exposing the link to every editor.
it("hides the Team link from an org editor (isAdmin but not isOrgAdmin)", () => {
  renderSidebar(roles({ isOrgAdmin: false }));
  expect(screen.getByText("Events")).toBeInTheDocument();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("shows the Team link to an org admin", () => {
  renderSidebar(roles({ isOrgAdmin: true }));
  expect(screen.getByText("Team")).toBeInTheDocument();
});

// The PLATFORM · SUPER ADMIN group (Organizations, Commission, Payouts) is
// gated on isSuperAdmin alone — Sidebar.tsx:83. A regular org admin must
// never see it, regardless of isOrgAdmin.
it("hides the PLATFORM super-admin group from a regular org admin", () => {
  renderSidebar(roles({ isSuperAdmin: false, isOrgAdmin: true }));
  expect(screen.queryByText("PLATFORM")).not.toBeInTheDocument();
  expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
});

it("shows the PLATFORM super-admin group to a super_admin", () => {
  renderSidebar(roles({ isSuperAdmin: true }));
  expect(screen.getByText("PLATFORM")).toBeInTheDocument();
  expect(screen.getByText("Organizations")).toBeInTheDocument();
  expect(screen.getByText("Commission")).toBeInTheDocument();
  expect(screen.getByText("Payouts")).toBeInTheDocument();
});

it("shows the caller's email-derived name and role label", () => {
  renderSidebar(roles({ isSuperAdmin: true }));
  expect(screen.getByText("admin")).toBeInTheDocument();
  expect(screen.getByText("Super admin")).toBeInTheDocument();
});

it("shows nav-count pills for Events and Registrations when counts are provided", () => {
  renderSidebar(roles());
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText("847")).toBeInTheDocument();
});

// requireOrgId() returns null for a bare super_admin with no org-scoped row
// — the (admin) layout passes counts: null in that case rather than 0s,
// which would misleadingly read as "zero events". Sidebar must render the
// nav without pills, not crash on a missing counts object.
it("renders the nav without count pills when counts is null (no org scope)", () => {
  render(
    <SidebarProvider>
      <Sidebar roles={roles({ isSuperAdmin: true, orgId: null })} email="admin@racepace.test" orgName={null} counts={null} />
    </SidebarProvider>,
  );
  expect(screen.getByText("Events")).toBeInTheDocument();
  expect(screen.queryByText("12")).not.toBeInTheDocument();
});
