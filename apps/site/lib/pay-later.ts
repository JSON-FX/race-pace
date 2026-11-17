import type { SupabaseClient } from "@supabase/supabase-js";
import { isRegistrationClosed } from "./eventStatus";

export type PayLaterTerms = { id: string; dueAt: string };

export async function fetchPayLaterTerms(
  db: SupabaseClient, eventId: string, userId: string, now = Date.now(),
): Promise<PayLaterTerms | null> {
  const { data, error } = await db.from("pay_later_grants").select("id,due_at,registration_id")
    .eq("event_id", eventId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("We could not check your payment terms. Please try again.");
  if (!data || data.registration_id || Date.parse(data.due_at) <= now || !Number.isFinite(Date.parse(data.due_at))) return null;
  return { id: data.id, dueAt: data.due_at };
}

export type PayLaterScreening = { batchId: string; passportId: string; categoryId: string; deadlineAt: string };
type ScreeningRow = {
  pay_later_registration_id?: string | null;
  id: string;
  status: string;
  checkout_intent: string;
  payment_deadline_at: string | null;
  booking_order_id: string | null;
  event_reservation_id: string | null;
  prescreening_applications: {
    participant_passport_id: string; category_id: string; decision: string;
    released_at: string | null; is_managed: boolean;
  }[];
};

export function eligiblePayLaterScreening(batch: ScreeningRow | null, now = Date.now()): PayLaterScreening | null {
  if (!batch || batch.status !== "ready" || batch.checkout_intent !== "entry" ||
      batch.booking_order_id || batch.event_reservation_id || batch.pay_later_registration_id) return null;
  const deadline = batch.payment_deadline_at;
  if (!deadline || (deadline !== "infinity" && (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= now))) return null;
  const remaining = batch.prescreening_applications.filter(application => !application.released_at);
  if (remaining.length !== 1) return null;
  const application = remaining[0];
  if (application.is_managed || !["approved", "not_required"].includes(application.decision)) return null;
  return { batchId: batch.id, passportId: application.participant_passport_id, categoryId: application.category_id, deadlineAt: deadline };
}

export async function fetchPayLaterScreening(
  db: SupabaseClient, batchId: string, eventId: string, userId: string,
): Promise<PayLaterScreening | null> {
  const { data, error } = await db.from("prescreening_batches")
    .select("id,status,checkout_intent,payment_deadline_at,booking_order_id,event_reservation_id,pay_later_registration_id,prescreening_applications(participant_passport_id,category_id,decision,released_at,is_managed)")
    .eq("id", batchId).eq("event_id", eventId).eq("booked_by_user_id", userId).maybeSingle();
  if (error) throw new Error("Your pre-screening approval could not be checked. Please try again.");
  return eligiblePayLaterScreening(data as ScreeningRow | null);
}

// The stored cutoff is exclusive next-day midnight. Show the preceding date in
// Philippine time so midnight never appears as an extra day available to pay.
export function payLaterDeadline(dueAt: string): string {
  const date = new Date(Date.parse(dueAt) - 1);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric",
  }).format(date) + " at 11:59 p.m. Philippine time";
}

export function paymentClosed(
  eventStatus: string, registrationClosesAt: string | null, payLaterDueAt?: string | null,
): boolean {
  return isRegistrationClosed(eventStatus, payLaterDueAt ? null : registrationClosesAt);
}
