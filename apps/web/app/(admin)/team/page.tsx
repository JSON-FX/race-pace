import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listTeam } from "@/lib/queries/team";
import { NoOrgScope } from "@/components/no-org-scope";
import { OrgAdminsOnly } from "@/components/org-admins-only";
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
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Team</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  // Who can VIEW the team is not "anyone who clears the (admin) layout's
  // isAdmin gate" (that includes editors/marshals/claiming roles) — it's
  // isOrgAdmin only ("admin" role, or super_admin). This isn't a UI
  // preference: the org-members edge function's caller-is-admin check runs
  // BEFORE its "list" action branch (supabase/functions/org-members/
  // index.ts), so a non-org-admin's listTeam call 403s server side. Branch
  // here, before calling listTeam, rather than letting that throw into an
  // uncaught 500 — an org editor who bookmarks /team must see an
  // explanatory notice, not a crash.
  if (!roles!.isOrgAdmin) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Team</h1>
        </div>
        <OrgAdminsOnly />
      </div>
    );
  }

  const { rows, total } = await listTeam(orgId, params);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Team</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="font-mono tabular">{total}</span> member{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ml-auto"><InviteMemberForm orgId={orgId} /></div>
      </div>

      <TeamTable
        rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q}
        orgId={orgId}
      />
    </div>
  );
}
