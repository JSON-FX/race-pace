import { TableEmptyState } from "@/components/data-table";
import { Card } from "@/components/ui/card";

/**
 * Rendered by TeamPage when the caller clears the (admin) layout's
 * `isAdmin` gate (so the URL is genuinely reachable — e.g. an org editor)
 * but isn't an org admin. This isn't cosmetic: the org-members edge
 * function's own caller-is-admin check runs BEFORE its "list" branch (see
 * supabase/functions/org-members/index.ts), so a non-org-admin's list call
 * 403s server side regardless of what this app renders — there is no
 * read-only "editor view" this page can actually offer. Showing this
 * notice (instead of calling listTeam and letting the 403 throw into an
 * uncaught 500) is what makes the URL safe to bookmark for every role, not
 * just admins. Matches NoOrgScope's shape/tone: non-alarming, explains why,
 * doesn't read as a bug.
 */
export function OrgAdminsOnly() {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
      <TableEmptyState
        title="Organization admins only"
        description="Managing your team's roles and invitations is limited to organization admins. Ask an admin if you need a change made here."
      />
    </Card>
  );
}
