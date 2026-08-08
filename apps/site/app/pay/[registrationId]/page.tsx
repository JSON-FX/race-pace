import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { PayPanel } from "./PayPanel";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/pay/${registrationId}`)}`);

  // An already-paid registration has nothing to pay — send them to the ticket.
  const { data: reg } = await db
    .from("registrations")
    .select("status,event_id,events(status,registration_closes_at)")
    .eq("id", registrationId)
    .maybeSingle();
  if (reg?.status === "paid") redirect(`/ticket/${registrationId}`);

  // The event can be cancelled after a runner registered, while their pending
  // registration still holds a live PayMongo session. Don't render a payable
  // screen for a race that no longer exists. `payment-session` enforces this
  // server-side too — that's the boundary; this is so the runner sees why.
  // PostgREST types a to-one embed as an array; it arrives as either shape
  // depending on the relationship it infers, so normalise both (mapReg does the
  // same for payments).
  const embedded = reg?.events as
    | { status: string; registration_closes_at: string | null }
    | { status: string; registration_closes_at: string | null }[]
    | null
    | undefined;
  const embeddedEvent = Array.isArray(embedded) ? embedded[0] : embedded;
  const eventStatus = embeddedEvent?.status;
  if (eventStatus && isRegistrationClosed(eventStatus, embeddedEvent?.registration_closes_at ?? null)) {
    redirect(`/events/${reg!.event_id}?closed=1`);
  }

  return (
    <>
      <SiteHeader />
      <main>
        <PayPanel registrationId={registrationId} />
      </main>
    </>
  );
}
