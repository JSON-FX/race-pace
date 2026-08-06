"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
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
import { ThemeToggle } from "./ThemeToggle";
import { signOutAction } from "@/lib/actions/auth";
import type { MyRoles } from "@/lib/queries/roles";

type Item = { to: string; label: string; icon: LucideIcon };

const ORG_ITEMS: Item[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/registrations", label: "Registrations", icon: ClipboardList },
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

function NavItem({ to, label, icon: Icon }: Item) {
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link href={to}>
          <Icon className={isActive ? "text-sidebar-primary" : "text-muted-foreground"} />
          <span className={isActive ? "font-semibold text-sidebar-accent-foreground" : "font-medium text-muted-foreground"}>
            {label}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function Sidebar({ roles, email }: { roles: MyRoles; email: string }) {
  const local = email.split("@")[0] || "admin";
  const initials = local.slice(0, 2).toUpperCase();
  const role = roles.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <UISidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Image src="/topnav-logo.png" alt="" width={26} height={26} className="shrink-0 object-contain" />
          <div className="group-data-[collapsible=icon]:hidden">
            <div className="text-base font-bold tracking-tight">Race Pace</div>
            <div className="text-[11px] text-muted-foreground">Admin console</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-wide">ORGANIZATION</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ORG_ITEMS.filter((it) => it.to !== "/team" || roles.isOrgAdmin).map((it) => (
                <NavItem key={it.to} {...it} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {roles.isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold tracking-wide">PLATFORM · SUPER ADMIN</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{SUPER_ITEMS.map((it) => <NavItem key={it.to} {...it} />)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-3">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-forest text-[11px] font-bold text-white">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-[13px] font-semibold">{local}</div>
            <div className="text-[11px] text-muted-foreground">{role}</div>
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
