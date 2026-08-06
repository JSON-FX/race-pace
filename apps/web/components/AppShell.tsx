import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { MyRoles } from "@/lib/queries/roles";

export function AppShell({
  roles, email, children,
}: { roles: MyRoles; email: string; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar roles={roles} email={email} />
      <SidebarInset className="bg-muted">
        <TopBar roles={roles} />
        <main className="rp-scroll flex-1 overflow-y-auto bg-muted">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
