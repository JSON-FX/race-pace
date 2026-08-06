import { useLocation } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { OrgSwitcher } from "./OrgSwitcher";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/events": "Events", "/registrations": "Registrations",
  "/payments": "Payments", "/check-in": "Race-day check-in", "/settings": "Settings",
  "/organizations": "Organizations", "/commission": "Commission", "/payouts": "Payout statements",
};

export function TopBar() {
  const { pathname } = useLocation();
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-4 border-b border-border bg-card px-4 md:px-[30px]">
      <SidebarTrigger />
      <div className="text-lg font-bold tracking-tight">{title}</div>
      {/* Owns the org name AND the switch — one control, so the label can
          never disagree with the org the pages are actually querying. */}
      <OrgSwitcher />
    </header>
  );
}
