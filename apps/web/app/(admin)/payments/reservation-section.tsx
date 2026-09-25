import { listReservationPayments } from "@/lib/queries/reservation-payments";
import { ReservationPaymentsTable } from "./reservation-payments-table";

export async function ReservationPaymentSection({ orgId, eventId }: { orgId: string; eventId?: string }) {
  const rows = await listReservationPayments(orgId, eventId);
  if (!rows.length) return null;
  return <ReservationPaymentsTable rows={rows} eventId={eventId} />;
}
