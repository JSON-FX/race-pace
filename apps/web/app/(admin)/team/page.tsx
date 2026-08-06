import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listTeam } from "@/lib/queries/team";
import { NoOrgScope } from "@/components/no-org-scope";
import { InviteMemberForm } from "@/components/InviteMemberForm";
import { TeamTable } from "./team-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: false }], filters: { role: "all" } };

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  // See requireOrgId's doc comment: a super_admin with no org-scoped
  // admin/editor row clears the (admin) layout's `isAdmin` guard with
  // `orgId: null`. Branch before calling any org-scoped query, don't assert
  // the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Team</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const { rows, total } = await listTeam(orgId, params);
  // Who can VIEW the team (any org-scoped admin/editor/marshal/claiming role
  // clears the (admin) layout guard) is not who can MANAGE it. Only
  // isOrgAdmin ("admin" role, or super_admin) may change roles or invite —
  // an editor must see a read-only list. This predicate gates the UI only;
  // the org-members edge function independently re-checks the caller server
  // side for every write (see lib/actions/team.ts).
  const canManage = roles!.isOrgAdmin;

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Team</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono tabular">{total}</span> member{total === 1 ? "" : "s"}
          </p>
        </div>
        {canManage ? <div className="ml-auto"><InviteMemberForm orgId={orgId} /></div> : null}
      </div>

      <TeamTable
        rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q}
        canManage={canManage} orgId={orgId}
      />
    </div>
  );
}
