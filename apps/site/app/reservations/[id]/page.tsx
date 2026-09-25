import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { eventPublicPath } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { ReservationStatusPanel } from "./ReservationStatusPanel";

export const dynamic = "force-dynamic";

function pesos(cents: number | null | undefined): string {
  return cents == null ? "Pending" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
}

export default async function ReservationPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returned?: string }>;
}) {
  const { id } = await params;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/reservations/${id}`)}`);
  const { data: reservation } = await db.from("event_reservations")
    .select("id,event_id,user_id,status,quantity,reservation_fee_cents,platform_fee_cents,registration_deadline_at,events(id,slug,name,status),reservation_payments(amount_cents,processor_fee_cents,checkout_url,status)")
    .eq("id", id).maybeSingle();
  if (!reservation || reservation.user_id !== user.id) notFound();
  const { data: places, error: placesError } = await db.from("event_reservation_places")
    .select("id,participant_name,status").eq("reservation_id", id).order("created_at");
  if (placesError) throw placesError;
  const event = reservation.events as unknown as { id: string; slug: string | null; name: string; status: string };
  const relatedPayment = reservation.reservation_payments as unknown as {
    amount_cents: number; processor_fee_cents: number | null; checkout_url: string | null; status: string;
  } | { amount_cents: number; processor_fee_cents: number | null; checkout_url: string | null; status: string }[] | null;
  const payment = Array.isArray(relatedPayment) ? relatedPayment[0] ?? null : relatedPayment;
  const { returned } = await searchParams;
  const deadline = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(reservation.registration_deadline_at));
  return <><SiteHeader /><main className="min-h-[80vh] bg-[#06120c] px-5 py-14 text-white">
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Race Pace / Early reservation</p>
      <h1 className="mt-3 text-4xl font-black uppercase tracking-tight sm:text-6xl">{event.name}</h1>
      <ReservationStatusPanel id={id} initialStatus={reservation.status} returned={returned === "1"}
        remaining={places?.length ? places.filter((place) => place.status === "held").length : reservation.status === "converted" ? 0 : 1} />
      <section className="mt-6 rounded-xl border border-white/20 p-5" aria-label="Reserved Race Passports">
        <h2 className="text-sm font-bold uppercase tracking-wider">{reservation.quantity} {reservation.quantity === 1 ? "event place" : "event places"}</h2>
        {places?.length ? <ul className="mt-3 space-y-2 text-sm text-white/80">{places.map((place) =>
          <li key={place.id} className="flex justify-between gap-4"><span>{place.participant_name}</span><span className="capitalize">{place.status.replaceAll("_", " ")}</span></li>
        )}</ul> : <p className="mt-2 text-sm text-white/70">Your event place is reserved.</p>}
      </section>
      <dl className="mt-6 space-y-3 border-t border-white/20 pt-5 text-sm">
        <div className="flex justify-between gap-4"><dt>Reservation fee{reservation.quantity > 1 ? ` × ${reservation.quantity}` : ""}</dt><dd>{pesos(reservation.reservation_fee_cents * reservation.quantity)}</dd></div>
        <div className="flex justify-between gap-4"><dt>Platform Fees{reservation.quantity > 1 ? ` × ${reservation.quantity}` : ""}</dt><dd>{pesos(reservation.platform_fee_cents * reservation.quantity)}</dd></div>
        <div className="flex justify-between gap-4"><dt>PayMongo fee</dt><dd>{pesos(payment?.processor_fee_cents)}</dd></div>
        <div className="flex justify-between gap-4 border-t border-white/20 pt-3 font-bold"><dt>Charged total</dt><dd>{payment?.status === "paid" ? pesos(payment.amount_cents) : "Shown at PayMongo checkout"}</dd></div>
      </dl>
      <p className="mt-7 text-sm leading-relaxed text-white/70">{reservation.status === "converted"
        ? "Your reservation became a paid event entry. The separate reservation fee remains nonrefundable."
        : <>Complete registration and secure entry payment by {deadline} PHT. The reservation fee is nonrefundable and separate from the later registration price. If you miss the deadline, your held place returns to event inventory.</>}</p>
      <div className="mt-7 flex flex-wrap gap-3">
        {reservation.status === "converted" ? <Link href="/races"
          className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold">View my race</Link> : null}
        {reservation.status === "pending" && payment?.checkout_url ? <a href={payment.checkout_url}
          className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold">Continue PayMongo checkout</a> : null}
        <Link href={eventPublicPath(event)} className="rounded-full border border-white/35 px-5 py-3 text-sm font-bold">View event</Link>
      </div>
    </div>
  </main></>;
}
