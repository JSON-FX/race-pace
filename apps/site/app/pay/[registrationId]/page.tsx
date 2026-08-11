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
    .select("status,event_id,expires_at,events(status)")
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
  const embedded = reg?.events as { status: string } | { status: string }[] | null | undefined;
  const eventStatus = (Array.isArray(embedded) ? embedded[0] : embedded)?.status;
  if (eventStatus && isRegistrationClosed(eventStatus)) {
    redirect(`/events/${reg!.event_id}?closed=1`);
  }

  // Deliberately NOT redirecting here on a lapsed hold (expires_at in the
  // past — a bookmarked /pay/<rid> or a direct push landing long after the
  // 24-hour window ran out). `?closed=1`/`?expired=1`-style query params are
  // never actually read by /events/[id] (confirmed: that page doesn't even
  // accept searchParams), so a redirect here would silently bounce the
  // runner to the event page with NO explanation — exactly the "clear
  // message" the final whole-branch review called for was missing. PayPanel
  // (a client component) already derives the same lapsed check from
  // `expires_at` via `holdExpired` and renders an explicit "Payment window
  // closed" screen with an "Enter again" link — on EVERY load, not just the
  // live-polling case — so leaving this to PayPanel covers the bookmark
  // scenario too, uniformly, the same way apps/mobile/app/pay/[registrationId].tsx
  // renders its lapsed state in place rather than bouncing away. The
  // authoritative boundary is still `payment-session` refusing server-side
  // (Finding 2) — this is purely about the runner seeing why, not security.

  return (
    <>
      <SiteHeader />
      <main>
        <PayPanel registrationId={registrationId} />
      </main>
    </>
  );
}
