"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import type { MyRoles } from "@/lib/queries/roles";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/events": "Events", "/registrations": "Registrations",
  "/payments": "Payments", "/check-in": "Race-day check-in", "/settings": "Settings",
  "/organizations": "Organizations", "/commission": "Commission", "/payouts": "Payout statements",
};

export function TopBar({ roles, orgName }: { roles: MyRoles; orgName: string | null }) {
  const pathname = usePathname();
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";
  const roleLabel = roles.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-4 border-b border-border bg-card px-4 md:px-[30px]">
      <SidebarTrigger />
      <div className="text-lg font-bold tracking-tight">{title}</div>
      <div className="ml-auto flex items-center gap-2">
        {/* orgName is null for a bare super_admin with no org-scoped row
            (see requireOrgId) — render just the role badge, not an empty gap. */}
        {orgName ? <span className="text-[13px] font-medium text-muted-foreground">{orgName}</span> : null}
        <Badge variant="secondary" className="text-[13px] font-semibold text-muted-foreground">
          {roleLabel}
        </Badge>
      </div>
    </header>
  );
}
