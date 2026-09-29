import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAddons, fetchCategories, fetchCategory, fetchEvent, fetchFormFields } from "@/lib/events";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { GroupRegister, type GroupPassport } from "../GroupRegister";

export const dynamic = "force-dynamic";

export default async function GroupRegisterPage({ params, searchParams }: { params: Promise<{ categoryId: string }>; searchParams: Promise<{ prescreening?: string; reservation?: string }> }) {
  if (process.env.GROUP_CHECKOUT_ENABLED !== "true") notFound();
  const { categoryId } = await params;
  const { prescreening: batchId, reservation: reservationId } = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/register/${categoryId}/group${batchId ? `?prescreening=${batchId}` : reservationId ? `?reservation=${reservationId}` : ""}`)}`);
  if (!user.email_confirmed_at || user.is_anonymous) redirect(`/sign-in?next=${encodeURIComponent(`/register/${categoryId}/group${batchId ? `?prescreening=${batchId}` : reservationId ? `?reservation=${reservationId}` : ""}`)}`);

  const category = await fetchCategory(db, categoryId);
  if (!category) notFound();
  const [event, categories, addons, fields] = await Promise.all([
    fetchEvent(db, category.event_id), fetchCategories(db, category.event_id), fetchAddons(db, category.event_id), fetchFormFields(db, category.event_id),
  ]);
  if (!event || !event.waiver_version_id) notFound();
  if (isRegistrationClosed(event.status, event.registration_closes_at)) redirect(`/events/${event.id}?closed=${categoryId}`);
  let approved: { id: string; participants: { passportId: string; categoryId: string }[] } | undefined;
  if (batchId) {
    const batch = await db.from("prescreening_batches").select("id,status,checkout_intent,payment_deadline_at,prescreening_applications(participant_passport_id,category_id,decision,released_at)")
      .eq("id", batchId).eq("event_id", event.id).eq("booked_by_user_id", user.id).maybeSingle();
    if (batch.error) throw new Error("Approval could not be checked");
    if (!batch.data) notFound();
    const remaining = batch.data.prescreening_applications.filter(a => !a.released_at);
    if (batch.data.status !== "ready" || batch.data.checkout_intent !== "entry" || !batch.data.payment_deadline_at ||
      Date.parse(batch.data.payment_deadline_at) <= Date.now() || !remaining.length || remaining.some(a => !["approved", "not_required"].includes(a.decision))) redirect(`/prescreening/${batchId}`);
    approved = { id: batchId, participants: remaining.map(a => ({ passportId: a.participant_passport_id, categoryId: a.category_id })) };
  }
  let reserved: { id: string; participants: { passportId: string; categoryId: string }[] } | undefined;
  if (reservationId && !batchId) {
    const held = await db.from("event_reservations").select("id,status,event_reservation_places(participant_passport_id,category_id,status,entry_payment_deadline_at)")
      .eq("id", reservationId).eq("event_id", event.id).eq("user_id", user.id).maybeSingle();
    if (held.error) throw new Error("Reserved places could not be checked");
    if (!held.data) notFound();
    if (held.data.status !== "paid") redirect(`/reservations/${reservationId}`);
    const remaining = held.data.event_reservation_places.filter(p => p.status === "held" && p.category_id &&
      Math.max(Date.parse(p.entry_payment_deadline_at ?? ""), Date.parse(categories.find(c => c.id === p.category_id)?.entry_payment_deadline_at ?? p.entry_payment_deadline_at ?? "")) > Date.now());
    if (!remaining.length) redirect(`/reservations/${reservationId}`);
    reserved = { id: reservationId, participants: remaining.map(p => ({ passportId: p.participant_passport_id, categoryId: p.category_id })) };
  }
  if (!approved && !reserved && categories.every(value => (value.general_available ?? value.slots_total - value.slots_taken) <= 0)) redirect(`/events/${event.id}?soldout=${categoryId}`);

  const [passportResult, waiverResult] = await Promise.all([
    db.from("runner_passports").select("id,claimed_user_id,first_name,last_name,shirt_size,blood_type,team_name,date_of_birth,gender,contact_number,emergency_contact_name,emergency_contact_number,emergency_contact_relationship,shipping_barangay_code,shipping_zip_code,shipping_address_line").order("created_at"),
    db.from("organizer_waiver_versions").select("id,title,body").eq("id", event.waiver_version_id).single(),
  ]);
  if (passportResult.error || waiverResult.error || !waiverResult.data) throw new Error("Group registration details are unavailable");
  const passports = (passportResult.data ?? []).filter(p => !p.claimed_user_id || p.claimed_user_id === user.id) as GroupPassport[];

  return <><SiteHeader /><main><GroupRegister userId={user.id} initialCategory={category} categories={categories} event={event} passports={passports} addons={addons} fields={fields} waiver={waiverResult.data} prescreening={approved} reservation={reserved} /></main></>;
}
