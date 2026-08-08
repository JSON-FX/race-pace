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
import { hasCapability, type Capability } from "@/lib/capabilities";

export type NavCounts = { events: number; registrations: number } | null;

export type NavItem = {
  to: string; label: string; icon: LucideIcon;
  countKey?: keyof NonNullable<NavCounts>;
  /** The capability required to reach this destination. Stated here so the
   *  nav and the route gate read the same list — previously each nav filter
   *  hand-wrote its own predicate and could drift from the page's check. */
  requires: Capability;
};

export const ORG_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, requires: "manage_org" },
  { to: "/events", label: "Events", icon: CalendarDays, countKey: "events", requires: "manage_org" },
  { to: "/registrations", label: "Registrations", icon: ClipboardList, countKey: "registrations", requires: "manage_org" },
  { to: "/payments", label: "Payments", icon: CreditCard, requires: "manage_org" },
  { to: "/check-in", label: "Check-in", icon: QrCode, requires: "check_in" },
  { to: "/team", label: "Team", icon: Users, requires: "manage_team" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, requires: "manage_org" },
];

export const SUPER_ITEMS: NavItem[] = [
  { to: "/organizations", label: "Organizations", icon: Building2, requires: "manage_platform" },
  { to: "/commission", label: "Commission", icon: Percent, requires: "manage_platform" },
  { to: "/payouts", label: "Payouts", icon: Banknote, requires: "manage_platform" },
];

/** Org-scoped nav, filtered by capability. Replaces the hand-written
 *  `it.to !== "/team" || roles.isOrgAdmin` predicate — same outcome for an
 *  admin and an editor, and now correct for a marshal too. */
export function visibleOrgItems(roles: MyRoles): NavItem[] {
  return ORG_ITEMS.filter((it) => hasCapability(roles.capabilities, it.requires));
}

/** PLATFORM group — Organizations / Commission / Payouts. */
export function visibleSuperItems(roles: MyRoles): NavItem[] {
  return SUPER_ITEMS.filter((it) => hasCapability(roles.capabilities, it.requires));
}

/**
 * The four destinations that earn a slot in the mobile bottom bar.
 *
 * Chosen by what someone actually does on a phone, not by sidebar order:
 * check-in is on the list because it is the one page used outdoors and
 * one-handed at a start line, while Settings and Team — configuration done
 * sitting down — are not.
 *
 * Four, not five: the fifth slot is always "More". The documented maximum is
 * five items total, and this console has ten destinations, so a More tab is
 * unavoidable — spending one of the five on it is the cost of the other nine
 * remaining reachable.
 */
const BOTTOM_BAR_PATHS = ["/dashboard", "/events", "/registrations", "/check-in"] as const;

/** Bottom-bar destinations, gated exactly as the sidebar gates them. */
export function primaryMobileItems(roles: MyRoles): NavItem[] {
  const visible = visibleOrgItems(roles);
  return BOTTOM_BAR_PATHS.map((p) => visible.find((it) => it.to === p)).filter(
    (it): it is NavItem => it !== undefined,
  );
}

/**
 * Everything not in the bottom bar, still grouped the way the sidebar groups it.
 *
 * Derived by subtraction rather than listed separately: a destination added to
 * ORG_ITEMS or SUPER_ITEMS shows up here automatically, so a new page can never
 * be silently unreachable on mobile — which is what a hand-maintained second
 * list would eventually cause.
 */
export function moreMobileItems(roles: MyRoles): { label: string; items: NavItem[] }[] {
  const inBar = new Set<string>(BOTTOM_BAR_PATHS);
  const org = visibleOrgItems(roles).filter((it) => !inBar.has(it.to));
  const platform = visibleSuperItems(roles);
  return [
    { label: "Organization", items: org },
    { label: "Platform", items: platform },
  ].filter((g) => g.items.length > 0);
}
