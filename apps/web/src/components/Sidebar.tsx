import { NavLink } from "react-router-dom";
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
import { useMyRoles } from "../lib/roles";
import { useAuth } from "../lib/auth";
import mark from "../assets/topnav-logo.png";

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
  return (
    <SidebarMenuItem>
      <NavLink to={to}>
        {({ isActive }) => (
          <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
            <span>
              <Icon className={isActive ? "text-sidebar-primary" : "text-muted-foreground"} />
              <span className={isActive ? "font-semibold" : "font-medium"}>{label}</span>
            </span>
          </SidebarMenuButton>
        )}
      </NavLink>
    </SidebarMenuItem>
  );
}

export function Sidebar() {
  const roles = useMyRoles();
  const { session, signOut } = useAuth();
  const email = session?.user.email ?? "";
  const local = email.split("@")[0] || "admin";
  const initials = local.slice(0, 2).toUpperCase();
  const role = roles.data?.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <UISidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src={mark} alt="" className="size-[26px] shrink-0 object-contain" />
          <div className="group-data-[collapsible=icon]:hidden">
            <div className="text-base font-bold tracking-tight">Race Pace</div>
            <div className="text-[11px] text-muted-foreground">Admin console</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>ORGANIZATION</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ORG_ITEMS.filter((it) => it.to !== "/team" || roles.data?.isOrgAdmin).map((it) => (
                <NavItem key={it.to} {...it} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {roles.data?.isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>PLATFORM · SUPER ADMIN</SidebarGroupLabel>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut()}
            className="text-destructive group-data-[collapsible=icon]:hidden"
          >
            Sign out
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </UISidebar>
  );
}
