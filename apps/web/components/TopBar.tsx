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

export function TopBar({ roles }: { roles: MyRoles }) {
  const pathname = usePathname();
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";
  // Org name (non-super-admin case) lands with lib/queries/org.ts's getOrg(orgId)
  // reader, built in the Settings task (Task 10) — not duplicated here to avoid a
  // competing org query.
  const roleLabel = roles.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-4 border-b border-border bg-card px-4 md:px-[30px]">
      <SidebarTrigger />
      <div className="text-lg font-bold tracking-tight">{title}</div>
      <Badge variant="secondary" className="ml-auto text-[13px] font-semibold text-muted-foreground">
        {roleLabel}
      </Badge>
    </header>
  );
}
