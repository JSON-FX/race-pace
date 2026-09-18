import { passportSchema } from "@race-pace/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCategory, fetchEvent, fetchAddons, fetchFormFields } from "@/lib/events";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterWizard } from "./RegisterWizard";
import { fetchMyEntry } from "@/lib/entry";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ categoryId: string }>; searchParams?: Promise<{ participant?: string }> }) {
  const selectedParticipant = (await searchParams)?.participant;
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

  if (!selectedParticipant && event.waiver_version_id) {
    const { data: participants, error } = await db.from("runner_passports").select("id,claimed_user_id,first_name,last_name").order("created_at");
    if (error) throw error;
    return <><SiteHeader /><main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">Who is joining?</h1>
      <p className="mt-3">Choose the participant's Race Passport. Each participant has a separate registration, payment and ticket.</p>
      {process.env.GROUP_CHECKOUT_ENABLED === "true" ? <Link className="mt-6 block rounded-lg bg-primary p-4 text-center font-semibold text-primary-foreground" href={`/register/${categoryId}/group`}>Register several participants in one payment</Link> : null}
      <ul className="mt-6 space-y-3">{participants?.filter(p => !p.claimed_user_id || p.claimed_user_id === user.id).map(p => <li key={p.id}>
        <Link className="block rounded-lg border p-4 underline" href={`/register/${categoryId}?participant=${p.id}`}>{p.claimed_user_id === user.id ? "Register myself" : `${p.first_name ?? "Incomplete"} ${p.last_name ?? "Passport"}`}</Link>
      </li>)}</ul>
      <Link className="mt-6 block underline" href="/profile">Create or complete a participant Passport</Link>
      <Link className="mt-3 block underline" href="/bookings">Bookings I manage</Link>
    </main></>;
  }

  // One entry per event. Same reasoning as the closed/sold-out redirects above:
  // the authoritative rejection is registrations-checkout's 409, but there is
  // no reason to walk a runner through three steps to reach it.
  const myEntry = selectedParticipant ? null : await fetchMyEntry(db, category.event_id, user.id);
  if (myEntry) {
    redirect(`/events/${category.event_id}?registered=${myEntry.id}`);
  }

  const { data: passport, error: passportError } = await db.from("runner_passports")
    .select("id,claimed_user_id,first_name,last_name,team_name,date_of_birth,gender,contact_number,emergency_contact_name,emergency_contact_number,emergency_contact_relationship")
    .eq(selectedParticipant ? "id" : "claimed_user_id", selectedParticipant ?? user.id).maybeSingle();
  if (passportError || !passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport).success) {
    return <><SiteHeader /><main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">Complete your Race Passport</h1>
      <p className="mt-4">{passportError ? "We could not check your Passport. Please try again." : "Add your name, birth date, gender, contact number and emergency contact details before registering."}</p>
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
        />
      </main>
    </>
  );
}
