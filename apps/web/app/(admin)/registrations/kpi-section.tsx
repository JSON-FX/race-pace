import { ClipboardList, CheckCircle2, Wallet, Undo2 } from "lucide-react";
import { getRegistrationAggregates } from "@/lib/queries/registrations";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { peso } from "@/lib/format";
import type { TableParams } from "@/lib/table-params";

/** The KPI row, split out of page.tsx so it can suspend independently of the
 *  table. Both read the SAME event and filters — see getRegistrationAggregates'
 *  doc comment for why the cards come from an RPC over the shared view rather
 *  than a sum over the table's rows. */
export async function RegistrationsKpiSection({ eventId, params }: {
  eventId: string;
  params: TableParams;
}) {
  const aggregates = await getRegistrationAggregates(eventId, params);

  return (
    <KpiRow>
      <KpiCard
        icon={ClipboardList}
        label="Total"
        value={aggregates.total.toLocaleString()}
        delta={{
          text: `+${aggregates.newThisWeek.toLocaleString()} this week`,
          tone: aggregates.newThisWeek > 0 ? "positive" : "neutral",
        }}
      />
      <KpiCard
        icon={CheckCircle2}
        label="Paid"
        value={aggregates.paid.toLocaleString()}
        delta={{
          text: `${aggregates.total > 0 ? ((aggregates.paid / aggregates.total) * 100).toFixed(1) : "0.0"}% conversion`,
          tone: "neutral",
        }}
      />
      {/* MoM delta omitted — see task-v2-report.md ("Deltas shipped vs
          omitted"): a month-over-month comparison needs a second
          time-windowed query with an ambiguous boundary (calendar month vs.
          rolling 30d) and reads as noise against this org's sparse,
          single-month seed data. Rather than fabricate a plausible-looking
          percentage, the card renders the value alone. */}
      <KpiCard icon={Wallet} label="Gross revenue" value={peso(aggregates.grossCents)} />
      <KpiCard
        icon={Undo2}
        label="Refunds"
        value={peso(aggregates.refundedCents)}
        delta={{
          // Deliberately NOT "· K pending": there is no refund-approval queue
          // in this schema yet (refunds run through refund_registration_tx,
          // supabase/migrations/20260723100000_money_txn_rpcs.sql, one atomic
          // transition straight to 'refunded' — the queue is Payments A2, not
          // yet built). "0 pending" would assert the system tracks pending
          // refunds and found none; it doesn't track them at all, so the
          // question is unanswerable, not answered-zero.
          text: `${aggregates.refundCount.toLocaleString()} request${aggregates.refundCount === 1 ? "" : "s"}`,
          tone: "neutral",
        }}
      />
    </KpiRow>
  );
}
