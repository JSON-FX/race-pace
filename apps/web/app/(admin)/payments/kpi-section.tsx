import { Wallet, Percent, Landmark, Undo2 } from "lucide-react";
import { getPaymentAggregates } from "@/lib/queries/payments";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { peso } from "@/lib/format";
import type { TableParams } from "@/lib/table-params";

/** No delta line on any Payments card — the binding spec's KPI table
 *  (docs/superpowers/specs/2026-08-06-admin-visual-parity-spec.md, "KPI row")
 *  lists only a peso value for Gross/Platform fees/Net to org/Refunded, and the
 *  mockup's tab A content view is the Registrations page, not Payments, so
 *  there is no `.kpi` delta markup to match here.
 *
 *  Same org + same filters as the table. Gross/fee/net come straight off
 *  admin_payments_v's own columns — see getPaymentAggregates' doc comment for
 *  why net is never recomputed as amount - fee here. */
export async function PaymentsKpiSection({ orgId, params }: {
  orgId: string;
  params: TableParams;
}) {
  const aggregates = await getPaymentAggregates(orgId, params);

  return (
    <KpiRow>
      <KpiCard icon={Wallet} label="Gross" value={peso(aggregates.grossCents)} />
      <KpiCard icon={Percent} label="Platform fees" value={peso(aggregates.feeCents)} />
      <KpiCard icon={Landmark} label="Net to org" value={peso(aggregates.netCents)} />
      <KpiCard icon={Undo2} label="Refunded" value={peso(aggregates.refundedCents)} />
    </KpiRow>
  );
}
