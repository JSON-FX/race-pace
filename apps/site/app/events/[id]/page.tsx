import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { formatDateRange } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { eventPublicPath, fetchEvent, fetchCategories, fetchAddons } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { EventPageBody } from "@/components/event/EventPageBody";
import { ComingSoonEventPage } from "@/components/event/ComingSoonEventPage";
import { longDate } from "@/lib/format";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { fetchMyEntry } from "@/lib/entry";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
type PageParams = Params & { searchParams: Promise<Record<string, string | string[] | undefined>> };

function withSearchParams(path: string, values: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

// This is the whole point of server rendering: an organizer pasting the link
// into a Facebook group gets a real preview card.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const db = await createClient();
  const event = await fetchEvent(db, id);
  if (!event) return { title: "Race not found" };

  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : "";
  const distances = event.distances.length ? `${event.distances.map((d) => `${d}K`).join(" · ")}. ` : "";
  const description = event.status === "coming_soon"
    ? (event.description ?? "Registration opens soon on Race Pace.")
    : `${distances}${date}${event.city_name ? ` · ${event.city_name}` : ""}`.trim();
  const canonical = new URL(
    eventPublicPath(event),
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ).toString();

  return {
    title: event.name,
    description: description || undefined,
    alternates: { canonical },
    openGraph: {
      title: event.name,
      description: description || undefined,
      type: "website",
      url: canonical,
      images: event.hero_image_url ? [{ url: event.hero_image_url }] : undefined,
    },
  };
}

export default async function EventPage({ params, searchParams }: PageParams) {
  const { id } = await params;
  const db = await createClient();
  const event = await fetchEvent(db, id);
  if (!event) notFound();
  if (event.slug && id !== event.slug) {
    permanentRedirect(withSearchParams(eventPublicPath(event), await searchParams));
  }

  const { data: { user } } = await db.auth.getUser();

  if (event.status === "coming_soon") {
    const { data: reservation } = user ? await db.from("event_reservations")
      .select("id,status,quantity").eq("event_id", event.id).eq("user_id", user.id)
      .in("status", ["pending", "paid", "review_required"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const [placesResult, paymentResult] = reservation ? await Promise.all([
      db.from("event_reservation_places").select("participant_name,is_managed")
        .eq("reservation_id", reservation.id).order("created_at", { ascending: true }),
      db.from("reservation_payments").select("status,amount_cents,processor_fee_cents")
        .eq("reservation_id", reservation.id).maybeSingle(),
    ]) : [{ data: null }, { data: null }];
    return <><SiteHeader /><main><ComingSoonEventPage
      event={event} userEmail={user?.email ?? null} reservation={reservation ?? null}
      reservedPassports={placesResult.data ?? []} reservationPayment={paymentResult.data}
    /></main></>;
  }

  // Independent reads — sequential awaits would stack round trips before the
  // first byte.
  const [categories, addons, myEntry, paidReservation] = await Promise.all([
    fetchCategories(db, event.id),
    fetchAddons(db, event.id),
    fetchMyEntry(db, event.id, user?.id ?? null),
    user ? db.from("event_reservations").select("id,status,quantity,registration_deadline_at")
      .eq("event_id", event.id).eq("user_id", user.id).eq("status", "paid")
      .order("created_at", { ascending: false }).limit(1).maybeSingle().then((result) => result.data) : Promise.resolve(null),
  ]);
  const { data: reservationPlaces } = paidReservation ? await db.from("event_reservation_places")
    .select("status").eq("reservation_id", paidReservation.id) : { data: null };
  const reservationRemaining = paidReservation
    ? reservationPlaces?.length ? reservationPlaces.filter((place) => place.status === "held").length : 1
    : 0;
  // almost_full is still registerable — see lib/eventStatus.ts, mirrors
  // apps/mobile/app/event/[id].tsx's `registerable` rule.
  const closed = isRegistrationClosed(event.status, event.registration_closes_at);

  return (
    <>
      <SiteHeader />
      <main>
        <EventPageBody
          event={event}
          categories={categories}
          addons={addons}
          closed={closed}
          myEntry={myEntry}
          registrationClosesAt={event.registration_closes_at}
          reservationId={paidReservation && Date.parse(paidReservation.registration_deadline_at) > Date.now() ? paidReservation.id : null}
          reservationRemaining={reservationRemaining}
        />
      </main>
    </>
  );
}
