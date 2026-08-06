"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { CommandPalette } from "@/components/CommandPalette";
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

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-3 border-b border-divider bg-card px-4 md:px-[22px]">
      <SidebarTrigger />
      <Breadcrumb>
        <BreadcrumbList className="flex-nowrap gap-1.5 text-xs text-muted-foreground sm:gap-1.5">
          {/* orgName is null for a bare super_admin with no org-scoped row
              (see requireOrgId) — fall back to just the current page. */}
          {orgName ? (
            <BreadcrumbItem className="whitespace-nowrap">{orgName}</BreadcrumbItem>
          ) : null}
          {orgName ? <BreadcrumbItem className="text-muted-foreground">/</BreadcrumbItem> : null}
          <BreadcrumbItem>
            <BreadcrumbPage className="text-xs font-semibold text-foreground">{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center">
        <CommandPalette roles={roles} />
      </div>
    </header>
  );
}
