/**
 * Single source of truth for the sidebar's navigation model, split out so
 * both `components/Sidebar.tsx` and the ⌘K command palette
 * (`components/CommandPalette.tsx`) gate destinations identically. Before
 * this existed, the palette would have needed its own copy of the
 * `/team` → `isOrgAdmin` and PLATFORM group → `isSuperAdmin` gates, and the
 * two lists could silently drift — offering a super-admin-only destination
 * to an org editor is both a confusing dead end and an information leak
 * about pages that exist but the caller can't reach.
 *
 * Deliberately import-free apart from `lucide-react` (a value, but a pure
 * client-safe icon library) and `import type { MyRoles }` (erased at
 * compile time). It must NOT import anything from `@/lib/queries/roles`'s
 * runtime surface, `@/lib/supabase/server`, or any other server-only
 * module — those drag `next/headers` into any client component that
 * imports this file and break the build. See lib/team-roles.ts for the
 * precedent this follows.
 */
import {
  LayoutDashboard, CalendarDays, ClipboardList, CreditCard,
  QrCode, Users, Settings as SettingsIcon, Building2, Percent, Banknote, type LucideIcon,
} from "lucide-react";
import type { MyRoles } from "@/lib/queries/roles";

export type NavCounts = { events: number; registrations: number } | null;

export type NavItem = { to: string; label: string; icon: LucideIcon; countKey?: keyof NonNullable<NavCounts> };

export const ORG_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: CalendarDays, countKey: "events" },
  { to: "/registrations", label: "Registrations", icon: ClipboardList, countKey: "registrations" },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/check-in", label: "Check-in", icon: QrCode },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export const SUPER_ITEMS: NavItem[] = [
  { to: "/organizations", label: "Organizations", icon: Building2 },
  { to: "/commission", label: "Commission", icon: Percent },
  { to: "/payouts", label: "Payouts", icon: Banknote },
];

/** Org-scoped nav, filtered the same way Sidebar.tsx always has: Team is
 *  admin-only within the org (`isOrgAdmin`), everything else is visible to
 *  any org member the (admin) layout already let through. */
export function visibleOrgItems(roles: MyRoles): NavItem[] {
  return ORG_ITEMS.filter((it) => it.to !== "/team" || roles.isOrgAdmin);
}

/** PLATFORM group — Organizations / Commission / Payouts — super_admin only. */
export function visibleSuperItems(roles: MyRoles): NavItem[] {
  return roles.isSuperAdmin ? SUPER_ITEMS : [];
}
