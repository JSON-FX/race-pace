import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listOrgPayments } from "@/lib/queries/payments";
import { NoOrgScope } from "@/components/no-org-scope";
import { PaymentsTable } from "./payments-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", method: "all" } };

export default async function PaymentsPage({
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
          <h1 className="text-xl font-bold tracking-tight">Payments</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const { rows, total } = await listOrgPayments(orgId, params);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Payments</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <span className="font-mono tabular">{total}</span> transaction{total === 1 ? "" : "s"}
        </p>
      </div>
      <PaymentsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} />
    </div>
  );
}
