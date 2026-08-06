import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { MyRoles } from "@/lib/queries/roles";

export type NavCounts = { events: number; registrations: number } | null;

export function AppShell({
  roles, email, orgName, counts, children,
}: {
  roles: MyRoles;
  email: string;
  orgName: string | null;
  counts: NavCounts;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <Sidebar roles={roles} email={email} orgName={orgName} counts={counts} />
      <SidebarInset className="bg-muted">
        <TopBar orgName={orgName} />
        <main className="rp-scroll flex-1 overflow-y-auto bg-muted">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
