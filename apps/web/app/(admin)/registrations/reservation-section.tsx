import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso } from "@/lib/format";

export async function ReservationRosterSection({ eventId, orgId }: { eventId: string; orgId: string }) {
  const db = await createClient();
  const { data: reservations, error } = await db.from("event_reservations")
    .select("id,email,status,quantity,registration_deadline_at,reservation_fee_cents,created_at,event_reservation_places(id,participant_name,is_managed,status),reservation_payments(amount_cents,status)")
    .eq("event_id", eventId).eq("org_id", orgId)
    .order("created_at", { ascending: false }).limit(501);
  if (error) throw error;
  if ((reservations?.length ?? 0) > 500) throw new Error("Reservation roster exceeds its safe page size.");
  if (!reservations?.length) return null;

  return <section className="mt-8" aria-labelledby="registrations-reservations-title">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="registrations-reservations-title" className="text-lg font-bold">Early reservations</h2>
        <p className="mt-1 text-sm text-muted-foreground">{reservations.length} reservation {reservations.length === 1 ? "checkout" : "checkouts"} for this event. These places are separate from registrations.</p>
      </div>
      <Link href={`/events/${eventId}/reservations`} className="text-sm font-semibold text-primary hover:underline">Open full reservation roster →</Link>
    </div>
    <div className="overflow-x-auto rounded-xl border border-divider bg-card shadow-card">
      <Table className="w-full min-w-[750px] text-left">
        <TableHeader className="border-b"><TableRow>
          <TableHead className="p-4">Runner / Race Passports</TableHead><TableHead className="p-4">Status</TableHead>
          <TableHead className="p-4">Places</TableHead><TableHead className="p-4">Entry payment due</TableHead>
          <TableHead className="p-4 text-right">Reservation paid</TableHead>
        </TableRow></TableHeader>
        <TableBody>{reservations.map((reservation) => {
          const payment = (Array.isArray(reservation.reservation_payments)
            ? reservation.reservation_payments[0] : reservation.reservation_payments) as
            { amount_cents: number; status: string } | null;
          const places = reservation.event_reservation_places as
            { id: string; participant_name: string; is_managed: boolean; status: string }[] | null;
          const own = places?.find((place) => !place.is_managed);
          return <TableRow key={reservation.id} className="border-b last:border-0">
            <TableCell className="p-4"><div className="font-semibold">{own?.participant_name ?? reservation.email}</div>
              <div className="text-xs text-muted-foreground">{reservation.email}</div>
              {places?.filter((place) => place.is_managed).map((place) => <div key={place.id} className="mt-1 text-xs">
                {place.participant_name} · Managed Passport · {place.status.replaceAll("_", " ")}
              </div>)}
            </TableCell>
            <TableCell className="p-4 capitalize">{reservation.status.replaceAll("_", " ")}</TableCell>
            <TableCell className="p-4 tabular-nums">{reservation.quantity}</TableCell>
            <TableCell className="p-4">{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(reservation.registration_deadline_at))} PHT</TableCell>
            <TableCell className="p-4 text-right tabular-nums">{payment?.status === "paid" ? peso(payment.amount_cents) : "Pending"}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>
  </section>;
}
