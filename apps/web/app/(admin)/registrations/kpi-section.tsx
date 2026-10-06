import { ClipboardList, CheckCircle2, Wallet, Undo2, Banknote } from "lucide-react";
import { getRegistrationAggregates, getEventRegistrationGross, getEventOrganizerNet } from "@/lib/queries/registrations";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { peso } from "@/lib/format";
import type { TableParams } from "@/lib/table-params";

export const REGISTRATION_KPI_GRID = "min-[760px]:grid-cols-3 min-[1200px]:grid-cols-5";

/** Gross and organizer net describe the whole event; count/refund cards follow table filters. */
export async function RegistrationsKpiSection({ orgId, eventId, params }: {
  orgId: string;
  eventId: string;
  params: TableParams;
}) {
  const [aggregates, eventGross, eventNet] = await Promise.all([
    getRegistrationAggregates(eventId, params),
    getEventRegistrationGross(eventId),
    getEventOrganizerNet(orgId, eventId),
  ]);

  return (
    <KpiRow className={REGISTRATION_KPI_GRID}>
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
      <KpiCard
        icon={Banknote}
        label="Gross Registration"
        value={eventGross === null ? "Unavailable" : peso(eventGross)}
        delta={{ text: "Whole event · before fees/refunds", tone: "neutral" }}
      />
      <KpiCard
        icon={Wallet}
        label="Net to organizer"
        value={eventNet === null ? "Unavailable" : peso(eventNet)}
        delta={{ text: eventNet === null ? "Earnings incomplete or unavailable" : "Whole event · after fees/refunds", tone: "neutral" }}
      />
      <KpiCard
        icon={Undo2}
        label="Refunds"
        value={peso(aggregates.refundedCents)}
        delta={{
          // Counts registrations with completed full or partial refunds, not requests.
          text: `${aggregates.refundCount.toLocaleString()} refunded registration${aggregates.refundCount === 1 ? "" : "s"}`,
          tone: "neutral",
        }}
      />
    </KpiRow>
  );
}
