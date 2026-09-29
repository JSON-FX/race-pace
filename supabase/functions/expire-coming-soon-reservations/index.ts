import { reconcileExpiredGroup } from "../_shared/groupExpiry.ts";
import { isAuthorizedBearer } from "../_shared/authz.ts";
import { confirmPayment } from "../_shared/confirm.ts";
import { pmExpireCheckoutSession, pmGetCheckoutSession, pmMethodFromSession } from "../_shared/paymongo.ts";
import { verifyReservationPayment } from "../_shared/reservationPayment.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAuthorizedBearer(req.headers.get("Authorization"), Deno.env.get("PAYMENT_EXPIRY_WORKER_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }
  const db = serviceClient();
  const candidateRead = await db.rpc("coming_soon_expiry_candidates", { p_limit: 50 });
  if (candidateRead.error) return json({ error: "candidate_read_failed" }, 503);
  const ids = (candidateRead.data ?? []) as string[];
  if (!ids.length) return json({ processed: 0, outcomes: {} });
  const { data: reservations, error } = await db.from("event_reservations")
    .select("id,status,checkout_expires_at,registration_deadline_at,events(status),event_reservation_places(participant_passport_id,status,category_id,entry_payment_deadline_at,categories(entry_payment_deadline_at)),reservation_payments(status,provider_ref,checkout_request)")
    .in("id", ids);
  if (error) return json({ error: "candidate_read_failed" }, 503);
  const results: Record<string, number> = {};
  const count = (key: string) => { results[key] = (results[key] ?? 0) + 1; };
  for (const reservation of reservations ?? []) {
    const event = reservation.events as unknown as { status: string } | null;
    const payment = (Array.isArray(reservation.reservation_payments)
      ? reservation.reservation_payments[0] : reservation.reservation_payments) as
      { status: string; provider_ref: string | null; checkout_request: unknown } | null;
    const places = reservation.event_reservation_places as unknown as { participant_passport_id:string;status:string;category_id:string|null;entry_payment_deadline_at:string|null;categories:{entry_payment_deadline_at:string|null}|null }[];
    const duePassports = new Set((places ?? []).filter(p => p.status === "held" &&
      (p.category_id !== null || event?.status !== "coming_soon") &&
      Math.max(Date.parse(p.entry_payment_deadline_at ?? reservation.registration_deadline_at), Date.parse(p.categories?.entry_payment_deadline_at ?? p.entry_payment_deadline_at ?? reservation.registration_deadline_at)) <= Date.now()).map(p => p.participant_passport_id));
    const due = reservation.status === "pending"
      ? Date.parse(reservation.checkout_expires_at) <= Date.now()
      : places?.length ? duePassports.size > 0 : event?.status !== "coming_soon" && Date.parse(reservation.registration_deadline_at) <= Date.now();
    if (!due) continue;
    try {
      if (!payment) { count("payment_missing"); continue; }
      if (reservation.status === "pending") {
        if (!payment.provider_ref && payment.checkout_request) { count("unbound_provider_session"); continue; }
        if (payment.provider_ref) {
          await pmExpireCheckoutSession(payment.provider_ref);
          const session = await pmGetCheckoutSession(payment.provider_ref);
          if (session.id !== payment.provider_ref) { count("session_mismatch"); continue; }
          if (session.paid) {
            const verified = await verifyReservationPayment(reservation.id);
            count(verified.status === "paid" ? "captured" : "capture_review_required");
            continue;
          }
          if (session.status !== "expired") { count("provider_session_active"); continue; }
          const finished = await db.rpc("finish_reservation_checkout_expiry", { p_reservation: reservation.id, p_session: session.id,
            p_evidence: { source: "paymongo_get", status: "expired" } });
          if (finished.error) throw new Error("release_write_failed");
          count(String(finished.data)); continue;
        }
      } else {
        const { data: entries, error: entryError } = await db.from("registrations")
          .select("id,status,participant_passport_id,booking_order_id,payments(provider,provider_ref,checkout_request)")
          .eq("event_reservation_id", reservation.id).in("status", ["pending", "paid"]);
        if (entryError) throw new Error("entry_read_failed");
        let unresolved = false;
        for (const entry of entries ?? []) {
          if (entry.status === "paid" || (places?.length && !duePassports.has(entry.participant_passport_id))) continue;
          if (entry.booking_order_id) {
            const outcome = await reconcileExpiredGroup(entry.booking_order_id);
            if (!["reconciled", "expired", "cancelled"].includes(outcome)) unresolved = true;
            continue;
          }
          const entryPayment = (Array.isArray(entry.payments) ? entry.payments[0] : entry.payments) as
            { provider: string; provider_ref: string | null; checkout_request: unknown } | null;
          if (!entryPayment || (entryPayment.provider === "paymongo" && !entryPayment.provider_ref && entryPayment.checkout_request)) {
            unresolved = true;
            break;
          }
          if (entryPayment.provider_ref && entryPayment.provider === "paymongo") {
            await pmExpireCheckoutSession(entryPayment.provider_ref);
            const session = await pmGetCheckoutSession(entryPayment.provider_ref);
            if (session.id !== entryPayment.provider_ref) { unresolved = true; break; }
            if (session.paid) {
              const confirmed = await confirmPayment(entry.id, pmMethodFromSession(session), {
                source: "reservation-expiry-worker", session_id: session.id, session: session.raw,
              });
              count(confirmed.ok ? "entry_captured" : "entry_capture_review_required");
              unresolved = true;
              break;
            }
            if (session.status !== "expired") { unresolved = true; break; }
            const finished = await db.rpc("finish_paymongo_checkout_expiry", { p_registration_id: entry.id, p_session_id: session.id,
              p_provider_evidence: { source: "paymongo_get", status: "expired" } });
            if (finished.error || !["expired", "already_final"].includes(finished.data)) unresolved = true;
            continue;
          }
          const expired = await db.from("registrations").update({ status: "expired", expires_at: null })
            .eq("id", entry.id).eq("status", "pending").select("id");
          if (expired.error || !expired.data?.length) { unresolved = true; break; }
        }
        if (unresolved) { count("entry_unresolved"); continue; }
      }
      const released = await db.rpc("expire_event_reservation", { p_reservation_id: reservation.id });
      if (released.error) throw new Error("release_write_failed");
      count(String(released.data ?? "release_unknown"));
    } catch (cause) {
      console.error("[coming-soon-expiry] place remains held", {
        reservationId: reservation.id, error: String(cause),
      });
      count("retry_required");
    }
  }
  return json({ processed: reservations?.length ?? 0, outcomes: results });
});
