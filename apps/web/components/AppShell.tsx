import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
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
      <Sidebar roles={roles} email={email} orgName={orgName} counts={counts} />
      <SidebarInset className="bg-muted">
        <TopBar roles={roles} orgName={orgName} orgContext={orgContext} />
        <main className="rp-scroll flex-1 overflow-y-auto bg-muted">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
