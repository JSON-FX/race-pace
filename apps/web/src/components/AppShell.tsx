import { Outlet } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <SidebarProvider>
      <Sidebar />
      <SidebarInset className="bg-muted">
        <TopBar />
        <main className="rp-scroll flex-1 overflow-y-auto bg-muted">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
