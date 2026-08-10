import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCategory, fetchEvent, fetchAddons, fetchFormFields } from "@/lib/events";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterWizard } from "./RegisterWizard";
import { fetchMyEntry } from "@/lib/entry";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ params }: { params: Promise<{ categoryId: string }> }) {
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
  if (isRegistrationClosed(event.status)) {
    redirect(`/events/${category.event_id}?closed=${categoryId}`);
  }

  // Slot state is authoritative on the server at submit time, but there is no
  // reason to walk a runner through three steps just to reject them.
  if (category.slots_taken >= category.slots_total) {
    redirect(`/events/${category.event_id}?soldout=${categoryId}`);
  }

  // One entry per event. Same reasoning as the closed/sold-out redirects above:
  // the authoritative rejection is registrations-checkout's 409, but there is
  // no reason to walk a runner through three steps to reach it.
  const myEntry = await fetchMyEntry(db, category.event_id, user.id);
  if (myEntry) {
    redirect(`/events/${category.event_id}?registered=${myEntry.id}`);
  }

  return (
    <>
      <SiteHeader />
      <main>
        <RegisterWizard
          userId={user.id}
          category={category}
          event={event}
          addons={addons}
          formFields={formFields}
        />
      </main>
    </>
  );
}
