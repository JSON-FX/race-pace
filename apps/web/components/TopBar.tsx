"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { CommandPalette } from "@/components/CommandPalette";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import type { MyRoles } from "@/lib/queries/roles";
import type { OrgContext } from "@/lib/org-context";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/events": "Events", "/registrations": "Registrations",
  "/payments": "Payments", "/check-in": "Race-day check-in", "/settings": "Settings",
  "/organizations": "Organizations", "/commission": "Commission", "/payouts": "Payout statements",
};

export function TopBar({
  roles, orgName, orgContext,
}: { roles: MyRoles; orgName: string | null; orgContext: OrgContext }) {
  const pathname = usePathname();
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";

  return (
    // `min-w-0` on the header AND on the breadcrumb below is what stops the
    // sideways scroll. A flex item's default `min-width: auto` refuses to shrink
    // below its content, so the breadcrumb + a fixed-width switcher + a 180px
    // search box summed past the viewport and pushed the page 86px wide at
    // 375px. Nothing here was individually too big — the row just could not give.
    <header className="flex h-[66px] w-full min-w-0 shrink-0 items-center gap-2 border-b border-divider bg-card px-3 md:gap-3 md:px-[22px]">
      {/* The drawer is desktop-only now: below md the bottom bar owns navigation,
          and a 28px trigger in the top-left corner was both under the 44px
          minimum and in the worst possible spot for a thumb. */}
      <SidebarTrigger className="hidden md:inline-flex" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-1.5 text-xs text-muted-foreground sm:gap-1.5">
          {/* orgName is null for a bare super_admin with no org-scoped row
              (see requireOrgId) — fall back to just the current page.
              Hidden on mobile: the org is already named by the switcher beside
              it, and repeating it is what made the row overflow. */}
          {orgName ? (
            <BreadcrumbItem className="hidden whitespace-nowrap md:inline-flex">{orgName}</BreadcrumbItem>
          ) : null}
          {orgName ? (
            <BreadcrumbItem className="hidden text-muted-foreground md:inline-flex">/</BreadcrumbItem>
          ) : null}
          <BreadcrumbItem className="min-w-0">
            {/* Truncates instead of pushing the row wide. "Race-day check-in"
                and "Payout statements" both overflow a 375px header otherwise. */}
            <BreadcrumbPage className="truncate text-[13px] font-semibold text-foreground md:text-xs">
              {title}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {/* Right of the title, before the palette: which org the console is
          acting as belongs next to the breadcrumb that names it, not buried
          in a menu. `ml-auto` lives here rather than in OrgSwitcher so the
          switcher stays a plain component the layout can place anywhere. */}
      <div className="flex shrink-0 items-center gap-2">
        <OrgSwitcher
          availableOrgs={orgContext.availableOrgs}
          activeOrgId={orgContext.activeOrgId}
          isSuperAdmin={orgContext.isSuperAdmin}
          canSwitch={orgContext.canSwitch}
        />
        <CommandPalette roles={roles} />
      </div>
    </header>
  );
}
