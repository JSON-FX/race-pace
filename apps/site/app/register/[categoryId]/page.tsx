import { passportSchema } from "@race-pace/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCategory, fetchEvent, fetchAddons, fetchFormFields } from "@/lib/events";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterWizard } from "./RegisterWizard";
import { fetchMyEntry } from "@/lib/entry";
import { ParticipantPicker, type ParticipantSummary } from "./ParticipantPicker";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ categoryId: string }>; searchParams?: Promise<{ participant?: string; reservation_id?: string }> }) {
  const query = await searchParams;
  const selectedParticipant = query?.participant;
  const reservationId = query?.reservation_id;
  const { categoryId } = await params;
  const db = await createClient();

  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/register/${categoryId}`)}`);

  const category = await fetchCategory(db, categoryId);
  if (!category) notFound();

  const [event, addons, formFields] = await Promise.all([
    fetchEvent(db, category.event_id),
    fetchAddons(db, category.event_id),
    fetchFormFields(db, category.event_id),
  ]);
  if (!event) notFound();

  let reservedPassportIds: string[] | null = null;
  if (reservationId) {
    const { data: held } = await db.from("event_reservations")
      .select("id,event_id,user_id,status,registration_deadline_at")
      .eq("id", reservationId).maybeSingle();
    if (!held || held.event_id !== event.id || held.user_id !== user.id || held.status !== "paid" ||
        Date.parse(held.registration_deadline_at) <= Date.now()) {
      redirect(`/events/${event.slug ?? event.id}`);
    }
    const { data: places, error: placesError } = await db.from("event_reservation_places")
      .select("participant_passport_id,status").eq("reservation_id", reservationId);
    if (placesError) throw placesError;
    reservedPassportIds = (places ?? []).filter((place) => place.status === "held")
      .map((place) => place.participant_passport_id);
    if (selectedParticipant && !reservedPassportIds.includes(selectedParticipant)) {
      redirect(`/events/${event.slug ?? event.id}`);
    }
  }

  // Authoritative check lives in registrations-checkout (server, at submit
  // time) — this is a UX nicety so a runner with a stale/direct link to a
  // cancelled or closed event doesn't get walked through three steps just
  // to be rejected (or, worse, charged) at the end.
  if (isRegistrationClosed(event.status, event.registration_closes_at)) {
    redirect(`/events/${category.event_id}?closed=${categoryId}`);
  }

  // Slot state is authoritative on the server at submit time, but there is no
  // reason to walk a runner through three steps just to reject them.
  if (category.slots_taken >= category.slots_total) {
    redirect(`/events/${category.event_id}?soldout=${categoryId}`);
  }

  if (!selectedParticipant && event.waiver_version_id && (!reservationId || reservedPassportIds?.length)) {
    const { data: participants, error } = await db.from("runner_passports").select("id,claimed_user_id,first_name,last_name").order("created_at");
    if (error) throw error;
    return <><SiteHeader /><ParticipantPicker
      category={category}
      event={event}
      participants={((participants ?? []) as ParticipantSummary[]).filter((participant) => !reservedPassportIds || reservedPassportIds.includes(participant.id))}
      userId={user.id}
      groupCheckoutEnabled={process.env.GROUP_CHECKOUT_ENABLED === "true"}
      reservationId={reservationId}
    /></>;
  }

  // One entry per event. Same reasoning as the closed/sold-out redirects above:
  // the authoritative rejection is registrations-checkout's 409, but there is
  // no reason to walk a runner through three steps to reach it.
  const myEntry = selectedParticipant ? null : await fetchMyEntry(db, category.event_id, user.id);
  if (myEntry) {
    redirect(`/events/${category.event_id}?registered=${myEntry.id}`);
  }

  const { data: passport, error: passportError } = await db.from("runner_passports")
    .select("id,claimed_user_id,first_name,last_name,team_name,date_of_birth,gender,contact_number,emergency_contact_name,emergency_contact_number,emergency_contact_relationship,shipping_barangay_code,shipping_zip_code,shipping_address_line")
    .eq(selectedParticipant ? "id" : "claimed_user_id", selectedParticipant ?? user.id).maybeSingle();
  if (passportError || !passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport).success) {
    return <><SiteHeader /><main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">Complete your Race Passport</h1>
      <p className="mt-4">{passportError ? "We could not check your Passport. Please try again." : "Add your identity, contact, emergency and shipping details before registering."}</p>
      <Link className="mt-6 inline-block underline" href="/profile">Open Race Passport</Link>
      <p className="mt-4"><Link className="underline" href={`/events/${category.event_id}`}>Return to event</Link></p>
    </main></>;
  }

  // Older events can still be open without an organizer waiver. Checkout
  // rejects them; stop the runner before showing the generic legacy text.
  if (!event.waiver_version_id) {
    return <><SiteHeader /><main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">Registration is temporarily unavailable</h1>
      <p className="mt-4">The organizer needs to publish an event waiver before registration can open.</p>
      <Link className="mt-6 inline-block underline" href={`/events/${category.event_id}`}>Return to event</Link>
    </main></>;
  }

  const { data: waiver } = event.waiver_version_id
    ? await db.from("organizer_waiver_versions").select("id,title,body").eq("id", event.waiver_version_id).single()
    : { data: null };
  if (event.waiver_version_id && !waiver) throw new Error("Event waiver could not be loaded");

  return (
    <>
      <SiteHeader />
      <main>
        <RegisterWizard
          participantId={passport!.id}
          assisted={passport!.claimed_user_id !== user.id}
          waiver={waiver}
          userId={user.id}
          passport={passportSchema(new Date().toISOString().slice(0, 10)).parse(passport)}
          email={user.email}
          category={category}
          event={event}
          addons={addons}
          formFields={formFields}
          reservationId={reservationId}
        />
      </main>
    </>
  );
}
