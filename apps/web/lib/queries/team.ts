import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";

// Role constants (ASSIGNABLE_ROLES, ROLE_LABELS) intentionally live in
// @/lib/team-roles, NOT here — see that file's doc comment. This module
// pulls in @/lib/supabase/server (next/headers), so any runtime value
// exported from here becomes unsafe for a client component to import.

export type TeamMember = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
  // NOTE: the org-members edge function (supabase/functions/org-members,
  // out of scope for this task to modify) does not return any
  // invite/confirmation state — a user_roles row is written the moment an
  // invite is sent, identical to an accepted member's row. There is
  // currently no real signal this query can use to populate "invited"
  // distinctly from "active", so listTeam always returns "active" today.
  // The field is kept (and the table/tests support rendering "Invited")
  // because the brief's interface requires it and TeamTable must not
  // silently break if a future edge-function change starts sending it.
  status: "active" | "invited";
};

type RawMember = { user_id: string; email: string | null; full_name: string | null; role: string; created_at: string };

/** Mirrors the old useOrgMembers()'s error mapping verbatim (lib/team.ts). */
function errorMessage(error: unknown): string {
  const status = (error as { context?: { status?: number } }).context?.status;
  return status === 403 ? "You don't have permission to manage this team."
    : status === 409 ? "An organization must keep at least one admin."
    : status === 502 ? "Couldn't send the invite — try again."
    : status === 400 ? "That role can't be assigned."
    : "Something went wrong. Please try again.";
}

/**
 * The org-members edge function (not this app) is the authorization
 * boundary and the source of truth for team membership: it checks the
 * caller is an org admin/super_admin with the service role, so this list
 * call only ever returns something for a caller who is actually allowed to
 * see it. It has no query params, so filtering/sorting/pagination for the
 * DataTable contract are applied here, in memory, after the fetch.
 */
export async function listTeam(
  orgId: string,
  params: TableParams,
): Promise<{ rows: TeamMember[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("org-members", {
    body: { action: "list", org_id: orgId },
  });
  if (error) throw new Error(errorMessage(error));

  const members = ((data as { members?: RawMember[] })?.members ?? []).map(
    (m): TeamMember => ({ ...m, status: "active" }),
  );

  let filtered = members;

  const role = params.filters.role ?? "all";
  if (role !== "all") filtered = filtered.filter((m) => m.role === role);

  const term = params.q.trim().toLowerCase();
  if (term) {
    filtered = filtered.filter(
      (m) => (m.full_name ?? "").toLowerCase().includes(term) || (m.email ?? "").toLowerCase().includes(term),
    );
  }

  const s = params.sort[0] ?? { id: "created_at", desc: false };
  const sorted = [...filtered].sort((a, b) => {
    const av = a[s.id as keyof TeamMember] ?? "";
    const bv = b[s.id as keyof TeamMember] ?? "";
    const cmp = String(av).localeCompare(String(bv));
    return s.desc ? -cmp : cmp;
  });

  const total = sorted.length;
  const from = (params.page - 1) * params.per;
  const rows = sorted.slice(from, from + params.per);

  return { rows, total };
}
