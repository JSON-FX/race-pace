import type { PrescreeningBatchStatus, PrescreeningDecision } from "@race-pace/shared";
export type ScreeningApplication = {
  id: string; category_id: string; participant_passport_id: string; participant_name: string; is_managed: boolean;
  decision: PrescreeningDecision; screening_required: boolean; requirement_snapshot: string | null;
  proof_upload_id: string | null; explanation: string | null; rejection_reason: string | null; released_at: string | null;
  event_reservation_places?: { reservation_fee_cents: number | null }[];
  categories: { label: string; base_price: number; reservation_fee_cents: number | null };
};
export type ScreeningBatch = {
  id: string; event_id: string; status: PrescreeningBatchStatus; checkout_intent: "entry" | "reservation";
  created_at: string; payment_deadline_at: string | null; booking_order_id: string | null; event_reservation_id: string | null;
  prescreening_applications: ScreeningApplication[];
};
export function screeningSummary(batch: ScreeningBatch, now = Date.now()) {
  const remaining = batch.prescreening_applications.filter(a => a.decision !== "rejected");
  const pending = remaining.filter(a => a.decision === "pending" && !a.released_at).length;
  const deadlinePassed = !!batch.payment_deadline_at && Date.parse(batch.payment_deadline_at) <= now;
  const payable = batch.status === "ready" && !deadlinePassed && pending === 0 && remaining.length > 0;
  const title = batch.status === "completed" ? "Your group payment is complete"
    : batch.status === "cancelled" ? "This request is closed"
    : batch.status === "expired" ? "Your payment window has expired"
    : deadlinePassed ? "Your payment window has ended"
    : payable ? "Your group is ready to pay"
    : pending ? "Your group’s slots are held" : "Waiting for payment to become available";
  const detail = batch.status === "completed" ? "Your paid booking now holds these places. Open it for entry or ticket details."
    : batch.status === "expired" ? "Unpaid places have been released. Start a new request, subject to availability."
    : batch.status === "cancelled" ? "No free review holds remain on this request."
    : deadlinePassed ? "Payment is disabled. We are checking any existing checkout before releasing unpaid places."
    : payable ? "Your approved categories are already selected. Complete one group payment before the deadline to keep these slots."
    : pending ? `${pending} ${pending === 1 ? "Passport is" : "Passports are"} awaiting review. No entry or reservation payment is due yet.`
    : "All required reviews are complete. Your slots stay held. We will email you when your full 72-hour payment window starts.";
  return { remaining, pending, payable, deadlinePassed, title, detail };
}
export const screeningDate = (value: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function screeningParticipantFee(application: ScreeningApplication, intent: "entry" | "reservation") {
  if (intent === "entry") return application.categories.base_price;
  // A provider retry must display the immutable fee already accepted by checkout.
  return application.event_reservation_places?.[0]?.reservation_fee_cents ?? application.categories.reservation_fee_cents ?? 0;
}
