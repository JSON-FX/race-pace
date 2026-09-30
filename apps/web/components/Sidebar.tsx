"use client";


import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Sidebar as UISidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LinkPending } from "./NavProgress";
import { signOutAction } from "@/lib/actions/auth";
import type { MyRoles } from "@/lib/queries/roles";
import { ROLE_LABELS, type AssignableRole } from "@/lib/team-roles";
import { visibleOrgItems, visibleSuperItems, type NavCounts, type NavItem as Item } from "@/lib/nav-items";

function NavItem({ to, label, icon: Icon, count }: Item & { count?: number }) {
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}
        className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary/90 data-[active=true]:hover:text-primary-foreground">
        <Link href={to}>
          <Icon className={isActive ? "text-primary-foreground" : "text-muted-foreground"} />
          <span className={isActive ? "font-semibold" : "font-medium text-muted-foreground"}>
            {label}
          </span>
          {count != null ? (
            <Badge variant="secondary"
              className={cn(
                "px-[7px] py-px tabular",
                isActive && "bg-primary-foreground/15 text-primary-foreground",
                // `ml-auto` moved to the pending spinner's wrapper below so the
                // two can't both claim it and fight over the right edge.
                count != null && "ml-auto",
              )}
            >
              {count}
            </Badge>
          ) : null}
          {/* Marks WHICH destination is loading. The top bar says a navigation
              is happening; this says which one, which matters when a mis-click
              is the reason the wait feels wrong. */}
          <LinkPending className={count != null ? "ml-1.5" : undefined} />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function Sidebar({
  roles, email, orgName, userAvatarUrl, counts,
}: { roles: MyRoles; email: string; orgName: string | null; userAvatarUrl?: string | null; counts: NavCounts }) {
  const local = email.split("@")[0] || "admin";
  const initials = local.slice(0, 2).toUpperCase();
  const role = roles.isSuperAdmin ? "Super admin" : ROLE_LABELS[roles.role as AssignableRole] ?? "Staff";
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <UISidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
          <div className="grid size-8 shrink-0 place-items-center" aria-hidden="true">
            <Image
              src="/topnav-logo.png"
              alt=""
              width={700}
              height={372}
              priority
              data-testid="race-pace-sidebar-logo"
              className="h-auto w-8 object-contain"
            />
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
              {visibleOrgItems(roles).map((it) => (
                <NavItem key={it.to} {...it} count={it.countKey && counts ? counts[it.countKey] : undefined} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleSuperItems(roles).length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              PLATFORM
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{visibleSuperItems(roles).map((it) => <NavItem key={it.to} {...it} />)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" title="Account" aria-label={`Account actions for ${local}`} className="min-w-0">
                  <PhotoAvatar
                    url={userAvatarUrl}
                    className="size-8"
                    fallbackClassName="bg-accent text-[11.5px] font-bold text-accent-foreground"
                    fallback={initials}
                  />
                  <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-[12.5px] font-bold">{local}</span>
                    <span className="truncate text-[10.5px] text-muted-foreground">{role}</span>
                  </span>
                  <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-48">
                <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                  Toggle dark mode
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action={signOutAction}>
                  <DropdownMenuItem asChild>
                    <Button type="submit" variant="ghost" size="sm" className="w-full justify-start"><LogOut />Sign out</Button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </UISidebar>
  );
}
