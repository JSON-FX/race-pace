"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar as UISidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { LinkPending } from "./NavProgress";
import { signOutAction } from "@/lib/actions/auth";
import type { MyRoles } from "@/lib/queries/roles";
import { visibleOrgItems, visibleSuperItems, type NavCounts, type NavItem as Item } from "@/lib/nav-items";

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
                "rounded-pill px-[7px] py-px text-[11px] font-semibold tabular",
                // `ml-auto` moved to the pending spinner's wrapper below so the
                // two can't both claim it and fight over the right edge.
                count != null && "ml-auto",
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
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
  roles, email, orgName, orgLogoUrl, counts,
}: { roles: MyRoles; email: string; orgName: string | null; orgLogoUrl?: string | null; counts: NavCounts }) {
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

      <SidebarFooter>
        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-3">
          {/* The org's own logo, the same one on its public event pages — this
              footer names the organization the admin is signed in to, so showing
              its branding beats two letters of an email local-part. */}
          <PhotoAvatar
            url={orgLogoUrl}
            className="size-[30px]"
            fallbackClassName="bg-accent text-[11.5px] font-bold text-accent-foreground"
            fallback={initials}
          />
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
