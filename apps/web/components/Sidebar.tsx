"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, ClipboardList, CreditCard,
  QrCode, Users, Settings as SettingsIcon, Building2, Percent, Banknote, type LucideIcon,
} from "lucide-react";
import {
  Sidebar as UISidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { signOutAction } from "@/lib/actions/auth";
import type { MyRoles } from "@/lib/queries/roles";
import type { NavCounts } from "./AppShell";

type Item = { to: string; label: string; icon: LucideIcon; countKey?: keyof NonNullable<NavCounts> };

const ORG_ITEMS: Item[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: CalendarDays, countKey: "events" },
  { to: "/registrations", label: "Registrations", icon: ClipboardList, countKey: "registrations" },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/check-in", label: "Check-in", icon: QrCode },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];
const SUPER_ITEMS: Item[] = [
  { to: "/organizations", label: "Organizations", icon: Building2 },
  { to: "/commission", label: "Commission", icon: Percent },
  { to: "/payouts", label: "Payouts", icon: Banknote },
];

function NavItem({ to, label, icon: Icon, count }: Item & { count?: number }) {
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link href={to}>
          <Icon className={isActive ? "text-primary" : "text-muted-foreground"} />
          <span className={isActive ? "font-semibold" : "font-medium text-muted-foreground"}>
            {label}
          </span>
          {count != null ? (
            <span
              className={cn(
                "ml-auto rounded-pill px-[7px] py-px font-mono text-[11px] font-semibold tabular",
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function Sidebar({
  roles, email, orgName, counts,
}: { roles: MyRoles; email: string; orgName: string | null; counts: NavCounts }) {
  const local = email.split("@")[0] || "admin";
  const initials = local.slice(0, 2).toUpperCase();
  const role = roles.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <UISidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
            RP
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="text-sm font-bold tracking-tight">Race Pace</div>
            <div className="truncate text-[10.5px] font-medium text-muted-foreground">
              {orgName ?? "No organization"}
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {ORG_ITEMS.filter((it) => it.to !== "/team" || roles.isOrgAdmin).map((it) => (
                <NavItem key={it.to} {...it} count={it.countKey && counts ? counts[it.countKey] : undefined} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {roles.isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              PLATFORM
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{SUPER_ITEMS.map((it) => <NavItem key={it.to} {...it} />)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-3">
          <Avatar className="size-[30px] shrink-0">
            <AvatarFallback className="bg-accent text-[11.5px] font-bold text-accent-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-[12.5px] font-bold">{local}</div>
            <div className="text-[10.5px] text-muted-foreground">{role}</div>
          </div>
          <ThemeToggle />
          <form action={signOutAction} className="group-data-[collapsible=icon]:hidden">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-[12px] font-semibold text-destructive"
            >
              Sign out
            </Button>
          </form>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </UISidebar>
  );
}
