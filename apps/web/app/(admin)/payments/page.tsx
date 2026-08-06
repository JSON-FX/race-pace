import Link from "next/link";
import { Wallet, Percent, Landmark, Undo2, Download } from "lucide-react";
import { parseTableParams, serializeTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listOrgPayments, getPaymentAggregates } from "@/lib/queries/payments";
import { NoOrgScope } from "@/components/no-org-scope";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { peso } from "@/lib/format";
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
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Payments</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const [{ rows, total }, aggregates] = await Promise.all([
    listOrgPayments(orgId, params),
    // Same org + same filters as the table above. Gross/fee/net come straight
    // off admin_payments_v's own columns — see getPaymentAggregates' doc
    // comment for why net is never recomputed as amount - fee here.
    getPaymentAggregates(orgId, params),
  ]);

  const exportHref = `/payments/export?${serializeTableParams({ ...params, page: 1 }, DEFAULTS)}`;

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Payments</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="tabular">{total}</span> transaction{total === 1 ? "" : "s"}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={exportHref}>
            <Download />
            Export CSV
          </Link>
        </Button>
      </div>

      {/* No delta line on any Payments card — the binding spec's KPI table
          (docs/superpowers/specs/2026-08-06-admin-visual-parity-spec.md,
          "KPI row") lists only a peso value for Gross/Platform fees/Net to
          org/Refunded, and the mockup's tab A content view is the
          Registrations page, not Payments, so there is no `.kpi` delta
          markup to match here. */}
      <KpiRow>
        <KpiCard icon={Wallet} label="Gross" value={peso(aggregates.grossCents)} />
        <KpiCard icon={Percent} label="Platform fees" value={peso(aggregates.feeCents)} />
        <KpiCard icon={Landmark} label="Net to org" value={peso(aggregates.netCents)} />
        <KpiCard icon={Undo2} label="Refunded" value={peso(aggregates.refundedCents)} />
      </KpiRow>

      <PaymentsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} />
    </div>
  );
}
