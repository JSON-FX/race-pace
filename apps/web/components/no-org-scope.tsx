import { TableEmptyState } from "@/components/data-table";
import { Card } from "@/components/ui/card";

/**
 * Rendered by org-scoped pages (Events, and Registrations/Payments/Team/
 * Settings/the editor after this) when `requireOrgId(roles)` (see
 * `@/lib/queries/roles`) comes back null: the caller is a legitimate admin
 * (e.g. a super_admin) but isn't attached to an organization, so there is
 * nothing to query. This is NOT a permissions failure — do not redirect to
 * /no-access, that reads as a bug to someone who genuinely has access.
 * Matches TableEmptyState's visual language (same icon/copy treatment)
 * inside its own rounded-xl card, since this renders outside a <DataTable>.
 */
export function NoOrgScope() {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
      <TableEmptyState
        title="No organization on this account"
        description="This account isn't attached to an organization, so there's nothing to show here. Org-scoped pages need an organization — ask a super admin to scope your account to one."
      />
    </Card>
  );
}
