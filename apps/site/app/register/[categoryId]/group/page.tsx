import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAddons, fetchCategory, fetchEvent, fetchFormFields } from "@/lib/events";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { GroupRegister, type GroupPassport } from "../GroupRegister";

export const dynamic = "force-dynamic";

export default async function GroupRegisterPage({ params }: { params: Promise<{ categoryId: string }> }) {
  if (process.env.GROUP_CHECKOUT_ENABLED !== "true") notFound();
  const { categoryId } = await params;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/register/${categoryId}/group`)}`);
  if (!user.email_confirmed_at || user.is_anonymous) redirect(`/sign-in?next=${encodeURIComponent(`/register/${categoryId}/group`)}`);

  const category = await fetchCategory(db, categoryId);
  if (!category) notFound();
  const [event, addons, fields] = await Promise.all([
    fetchEvent(db, category.event_id), fetchAddons(db, category.event_id), fetchFormFields(db, category.event_id),
  ]);
  if (!event || !event.waiver_version_id) notFound();
  if (isRegistrationClosed(event.status, event.registration_closes_at)) redirect(`/events/${event.id}?closed=${categoryId}`);
  if (category.slots_taken >= category.slots_total) redirect(`/events/${event.id}?soldout=${categoryId}`);

  const [passportResult, waiverResult] = await Promise.all([
    db.from("runner_passports").select("id,claimed_user_id,first_name,last_name,shirt_size,blood_type,team_name,date_of_birth,gender,contact_number,emergency_contact_name,emergency_contact_number,emergency_contact_relationship,shipping_barangay_code,shipping_zip_code,shipping_address_line").order("created_at"),
    db.from("organizer_waiver_versions").select("id,title,body").eq("id", event.waiver_version_id).single(),
  ]);
  if (passportResult.error || waiverResult.error || !waiverResult.data) throw new Error("Group registration details are unavailable");
  const passports = (passportResult.data ?? []).filter(p => !p.claimed_user_id || p.claimed_user_id === user.id) as GroupPassport[];

  return <><SiteHeader /><main><GroupRegister userId={user.id} category={category} event={event} passports={passports} addons={addons} fields={fields} waiver={waiverResult.data} /></main></>;
}
