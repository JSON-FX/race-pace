"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/events": "Events", "/registrations": "Registrations",
  "/payments": "Payments", "/check-in": "Race-day check-in", "/settings": "Settings",
  "/organizations": "Organizations", "/commission": "Commission", "/payouts": "Payout statements",
};

export function TopBar({ orgName }: { orgName: string | null }) {
  const pathname = usePathname();
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-[22px]">
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
        <button
          type="button"
          aria-label="Open search (command palette)"
          className="flex min-w-[180px] items-center gap-2 rounded-lg border border-border bg-card px-[11px] py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="size-[15px] shrink-0" strokeWidth={2} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded-md border border-border px-[5px] py-px font-mono text-[11px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
