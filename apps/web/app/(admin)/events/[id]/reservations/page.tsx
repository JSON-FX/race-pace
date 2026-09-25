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
    .select("id,email,status,quantity,reservation_fee_cents,platform_fee_cents,registration_deadline_at,paid_at,created_at,reservation_payments(amount_cents,processor_fee_cents,net_to_org_cents,status)")
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
      {reservations?.length ? <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-divider text-xs uppercase tracking-wide text-muted-foreground">
          <tr><th className="p-4">Booker and Race Passports</th><th className="p-4">Status</th><th className="p-4">Entry payment due</th>
            <th className="p-4 text-right">Reservation fee</th><th className="p-4 text-right">Platform Fees</th>
            <th className="p-4 text-right">PayMongo</th><th className="p-4 text-right">Paid total</th></tr>
        </thead>
        <tbody>{reservations.map((reservation) => {
          const payment = (Array.isArray(reservation.reservation_payments)
            ? reservation.reservation_payments[0] : reservation.reservation_payments) as
            { amount_cents: number; processor_fee_cents: number | null; status: string } | null;
          return <tr key={reservation.id} className="border-b border-divider/70 last:border-0">
            <td className="p-4 font-medium"><div>{reservation.email}</div>
              <div className="mt-1 text-xs font-normal text-muted-foreground">{reservation.quantity} {reservation.quantity === 1 ? "place" : "places"}</div>
              {(placesByReservation.get(reservation.id) ?? []).map((place) => <div key={place.id} className="mt-1 text-xs font-normal">
                {place.participant_name} · {place.is_managed ? "Managed Passport" : "Own Passport"} · {place.status.replaceAll("_", " ")}
              </div>)}
            </td>
            <td className="p-4 capitalize">{reservation.status.replaceAll("_", " ")}</td>
            <td className="p-4">{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(reservation.registration_deadline_at))} PHT</td>
            <td className="p-4 text-right tabular-nums">{peso(reservation.reservation_fee_cents * reservation.quantity)}</td>
            <td className="p-4 text-right tabular-nums">{peso(reservation.platform_fee_cents * reservation.quantity)}</td>
            <td className="p-4 text-right tabular-nums">{payment?.processor_fee_cents == null ? "Pending" : peso(payment.processor_fee_cents)}</td>
            <td className="p-4 text-right font-semibold tabular-nums">{payment?.status === "paid" ? peso(payment.amount_cents) : "Pending"}</td>
          </tr>;
        })}</tbody>
      </table> : <p className="p-8 text-sm text-muted-foreground">No reservations for this event yet.</p>}
    </div>
  </div>;
}
