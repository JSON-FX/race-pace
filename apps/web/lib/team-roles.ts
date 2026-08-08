/**
 * Pure role constants, deliberately split out of lib/queries/team.ts.
 *
 * lib/queries/team.ts imports `@/lib/supabase/server`, which imports
 * `next/headers` — server-only. Client components (TeamTable,
 * InviteMemberForm) need these role values at runtime, not just as types;
 * `import type` erases at compile time, but a plain `import { X }` does
 * not, and pulling ANY runtime binding out of lib/queries/team.ts drags its
 * whole module graph — including next/headers — into the client bundle and
 * breaks the build ("You're importing a component that needs
 * 'next/headers'..."). Keeping these values in their own import-free module
 * is what makes them safe to import from client components.
 *
 * Ported verbatim from the old lib/team.ts's ASSIGNABLE_ROLES/ROLE_LABELS.
 * This is the UI's picker list; the actual authorization source of truth
 * for which roles can be assigned is
 * supabase/functions/_shared/team.ts's ASSIGNABLE_ROLES, enforced
 * server-side by the org-members edge function. Keep these in sync with it.
 */
// `claiming` returns here once the race-kit spec gives it a capability to check.
export const ASSIGNABLE_ROLES = ["admin", "editor", "marshal"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
// Keep the `claiming` label for existing rows that may carry the role.
export const ROLE_LABELS: Record<AssignableRole | "claiming", string> = {
  admin: "Admin", editor: "Editor", marshal: "Marshal", claiming: "Race Kit",
};
