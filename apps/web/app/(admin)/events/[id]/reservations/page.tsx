import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { peso } from "@/lib/format";

export default async function EventReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  const db = await createClient();
  const { data: event } = await db.from("events").select("id,org_id,name,status").eq("id", id).maybeSingle();
  if (!event || (!roles?.isSuperAdmin && event.org_id !== roles?.orgId)) notFound();
  const { data: reservations, error } = await db.from("event_reservations")
    .select("id,email,status,quantity,reservation_fee_cents,platform_fee_cents,reservation_total_fee_cents,reservation_total_platform_fee_cents,registration_deadline_at,paid_at,created_at,reservation_payments(amount_cents,processor_fee_cents,net_to_org_cents,status)")
    .eq("event_id", id).order("created_at", { ascending: false }).limit(501);
  if (error) throw error;
  if ((reservations?.length ?? 0) > 500) throw new Error("Reservation roster exceeds its safe page size.");
  const places: Array<{ id: string; reservation_id: string; participant_name: string; is_managed: boolean; status: string }> = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data: batch, error: placesError } = await db.from("event_reservation_places")
      .select("id,reservation_id,participant_name,is_managed,status")
      .eq("event_id", id).order("created_at").order("id").range(offset, offset + 999);
    if (placesError) throw placesError;
    places.push(...(batch ?? []));
    if ((batch?.length ?? 0) < 1000) break;
  }
  const placesByReservation = new Map<string, typeof places>();
  for (const place of places) {
    const group = placesByReservation.get(place.reservation_id) ?? [];
    group.push(place);
    placesByReservation.set(place.reservation_id, group);
  }
  return <div className="px-4 pb-10 pt-6 md:px-[30px]">
    <Link href={`/events/${id}/edit`} className="text-sm font-semibold text-primary">← Back to event</Link>
    <h1 className="mt-5 text-2xl font-bold">Early reservations</h1>
    <p className="mt-1 text-sm text-muted-foreground">{event.name} · Event places are held separately from category registrations.</p>
    <div className="mt-6 overflow-x-auto rounded-xl border border-divider bg-card">
      {reservations?.length ? <Table className="w-full min-w-[760px] text-left">
        <TableHeader className="border-b uppercase">
          <TableRow><TableHead className="p-4">Booker and Race Passports</TableHead><TableHead className="p-4">Status</TableHead><TableHead className="p-4">Entry payment due</TableHead>
            <TableHead className="p-4 text-right">Reservation fee</TableHead><TableHead className="p-4 text-right">Platform Fees</TableHead>
            <TableHead className="p-4 text-right">PayMongo</TableHead><TableHead className="p-4 text-right">Paid total</TableHead></TableRow>
        </TableHeader>
        <TableBody>{reservations.map((reservation) => {
          const payment = (Array.isArray(reservation.reservation_payments)
            ? reservation.reservation_payments[0] : reservation.reservation_payments) as
            { amount_cents: number; processor_fee_cents: number | null; status: string } | null;
          return <TableRow key={reservation.id} className="border-b last:border-0">
            <TableCell className="p-4"><div>{reservation.email}</div>
              <div className="mt-1 text-xs font-normal text-muted-foreground">{reservation.quantity} {reservation.quantity === 1 ? "place" : "places"}</div>
              {(placesByReservation.get(reservation.id) ?? []).map((place) => <div key={place.id} className="mt-1 text-xs font-normal">
                {place.participant_name} · {place.is_managed ? "Managed Passport" : "Own Passport"} · {place.status.replaceAll("_", " ")}
              </div>)}
            </TableCell>
            <TableCell className="p-4 capitalize">{reservation.status.replaceAll("_", " ")}</TableCell>
            <TableCell className="p-4">{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(reservation.registration_deadline_at))} PHT</TableCell>
            <TableCell className="p-4 text-right tabular-nums">{peso((reservation.reservation_total_fee_cents ?? reservation.reservation_fee_cents * reservation.quantity))}</TableCell>
            <TableCell className="p-4 text-right tabular-nums">{peso((reservation.reservation_total_platform_fee_cents ?? reservation.platform_fee_cents * reservation.quantity))}</TableCell>
            <TableCell className="p-4 text-right tabular-nums">{payment?.processor_fee_cents == null ? "Pending" : peso(payment.processor_fee_cents)}</TableCell>
            <TableCell className="p-4 text-right tabular-nums">{payment?.status === "paid" ? peso(payment.amount_cents) : "Pending"}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table> : <p className="p-8 text-sm text-muted-foreground">No reservations for this event yet.</p>}
    </div>
  </div>;
}
