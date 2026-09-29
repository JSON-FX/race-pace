import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent } from "@/lib/events";
import type { ScreeningBatch } from "@/lib/prescreening-status";
import { SiteHeader } from "@/components/SiteHeader";
import { RequestStatus } from "./request-status";
export const dynamic = "force-dynamic";
export default async function ScreeningStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/prescreening/${id}`)}`);
  const { data, error } = await db.from("prescreening_batches")
    .select("id,event_id,status,checkout_intent,created_at,payment_deadline_at,booking_order_id,event_reservation_id,prescreening_applications(id,category_id,participant_passport_id,participant_name,is_managed,decision,screening_required,requirement_snapshot,proof_upload_id,explanation,rejection_reason,released_at,event_reservation_places(reservation_fee_cents),categories(label,base_price,reservation_fee_cents))")
    .eq("id", id).eq("booked_by_user_id", user.id).maybeSingle();
  if (error) throw new Error("This request could not be loaded. Try again.");
  if (!data) notFound();
  const event = await fetchEvent(db, data.event_id); if (!event) notFound();
  return <><SiteHeader /><RequestStatus batch={data as unknown as ScreeningBatch} event={event} /></>;
}
