import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { unsentCount } from "../lib/checkinQueue";

export function AppShell() {
  // Mounted for the whole authenticated session, not just /check-in — so a
  // marshal who navigates to Dashboard with scans still queued (which unmounts
  // the check-in route and, with it, any route-local warning) is still stopped
  // from closing the tab. Checked fresh at unload time rather than tracked as
  // React state, so it stays correct no matter which route unmounted last.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (unsentCount() === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

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
