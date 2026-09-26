import { createClient } from "@/lib/supabase/server";

export type ReservationPayoutRow = {
  eventId: string;
  eventName: string;
  orgName: string;
  eventFinished: boolean;
  paidCount: number;
  grossCents: number;
  platformFeeCents: number;
  processorFeeCents: number;
  netToOrgCents: number;
  statement: {
    id: string; status: "open" | "paid"; revision: number;
    payment_count: number; gross_cents: number; platform_fee_cents: number;
    processor_fee_cents: number; net_to_org_cents: number;
    reference: string | null; paid_at: string | null;
  } | null;
};

export async function listReservationPayoutRows(): Promise<ReservationPayoutRow[]> {
  const db = await createClient();
  const [payments, statements] = await Promise.all([
    db.from("reservation_payments")
      .select("id,event_id,status,amount_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents,events(name,status,event_date,end_date),organizations(name)")
      .eq("status", "paid").order("id").limit(1001),
    db.from("reservation_payout_statements")
      .select("id,event_id,status,revision,payment_count,gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents,reference,paid_at")
      .limit(1001),
  ]);
  if (payments.error || statements.error || (payments.data?.length ?? 0) > 1000 ||
      (statements.data?.length ?? 0) > 1000) {
    throw new Error("Reservation payout report is unavailable or exceeds its safe page size.");
  }
  const byEvent = new Map<string, ReservationPayoutRow>();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((value) => value.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  for (const payment of payments.data ?? []) {
    const event = payment.events as unknown as {
      name: string; status: string; event_date: string | null; end_date: string | null;
    } | null;
    const org = payment.organizations as unknown as { name: string } | null;
    const existing = byEvent.get(payment.event_id);
    const row = existing ?? {
      eventId: payment.event_id,
      eventName: event?.name ?? "Event",
      orgName: org?.name ?? "Organization",
      eventFinished: event?.status === "completed" || !!((event?.end_date ?? event?.event_date) &&
        (event?.end_date ?? event?.event_date)! < today),
      paidCount: 0, grossCents: 0, platformFeeCents: 0,
      processorFeeCents: 0, netToOrgCents: 0, statement: null,
    };
    row.paidCount++;
    row.grossCents += payment.amount_cents;
    row.platformFeeCents += payment.platform_fee_cents;
    row.processorFeeCents += payment.processor_fee_cents ?? 0;
    row.netToOrgCents += payment.net_to_org_cents ?? 0;
    byEvent.set(payment.event_id, row);
  }
  for (const statement of statements.data ?? []) {
    const row = byEvent.get(statement.event_id);
    if (row) row.statement = statement as ReservationPayoutRow["statement"];
  }
  return [...byEvent.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
}
