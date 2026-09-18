/**
 * What a console user may do, as opposed to what they are called.
 *
 * Four tiers because the console already draws four distinctions; this states
 * them once instead of spreading them across a layout gate, two nav filters and
 * a handful of per-page checks that could drift apart.
 *
 * Deliberately server-free — no next/headers, no Supabase, no imports at all —
 * so `lib/nav-items.ts` can value-import it without dragging server-only modules
 * into every client component. See that file's header for what happens otherwise.
 */
export type Capability =
  | "manage_platform" // Organizations, Commission, Payouts — every org's data
  | "manage_team"     // Team — org membership; admin-only within an org
  | "manage_org"      // Dashboard, Events, Registrations, Payments, Settings
  | "release_kits"
  | "check_in";       // the check-in station

const BY_ROLE: Record<string, Capability[]> = {
  admin: ["manage_team", "manage_org", "check_in", "release_kits"],
  editor: ["manage_org", "check_in", "release_kits"],
  marshal: ["check_in"],
  // Kit crew can operate the release station, without registration/payment access.
  claiming: ["release_kits"],
};

const ALL: Capability[] = ["manage_platform", "manage_team", "manage_org", "check_in", "release_kits"];

/** `role` is the caller's role IN THE RESOLVED ORG — not any role they hold
 *  anywhere. See roles.ts: orgId, isOrgAdmin and this must all describe the
 *  same single row, or a two-org user gets one org's data with another's powers. */
export function capabilitiesFor(role: string | null, isSuperAdmin: boolean): Capability[] {
  if (isSuperAdmin) return [...ALL];
  if (!role) return [];
  return [...(BY_ROLE[role] ?? [])];
}

export function hasCapability(caps: readonly Capability[], cap: Capability): boolean {
  return caps.includes(cap);
}
