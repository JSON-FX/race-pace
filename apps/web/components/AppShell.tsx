import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { NavProgressProvider, NavProgressBar } from "./NavProgress";
import type { MyRoles } from "@/lib/queries/roles";
import type { OrgContext } from "@/lib/org-context";
// Re-exported for callers that historically imported NavCounts from here;
// the canonical definition now lives in lib/nav-items.ts alongside the nav
// model it describes (shared by Sidebar and the ⌘K command palette).
export type { NavCounts } from "@/lib/nav-items";
import type { NavCounts } from "@/lib/nav-items";

export function AppShell({
  roles, email, orgName, counts, orgContext, children,
}: {
  roles: MyRoles;
  email: string;
  orgName: string | null;
  counts: NavCounts;
  orgContext: OrgContext;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      {/* The provider wraps BOTH the sidebar (where links report pending) and
          the inset (where the bar renders) — a shared ancestor is required, and
          putting it lower would leave the bar unable to see the links. */}
      <NavProgressProvider>
        <Sidebar roles={roles} email={email} orgName={orgName} counts={counts} />
        {/* `relative` anchors the absolutely-positioned bar to the content pane
            rather than the viewport, so it spans the content and not the
            sidebar — matching where the navigation actually lands. */}
        <SidebarInset className="relative bg-muted">
          <NavProgressBar />
          <TopBar roles={roles} orgName={orgName} orgContext={orgContext} />
          <main className="rp-scroll flex-1 overflow-y-auto bg-muted">{children}</main>
        </SidebarInset>
      </NavProgressProvider>
    </SidebarProvider>
  );
}
