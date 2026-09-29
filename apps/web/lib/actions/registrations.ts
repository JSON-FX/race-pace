"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RefundResponse = {
  ok: boolean; error?: string; pending?: boolean; already?: boolean; existing_request?: boolean;
  refund_amount?: number; total_paid?: number; retained_fees?: number;
};

async function requestRefund(body: Record<string, unknown>, group = false): Promise<RefundResponse> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke(group ? "admin-group-refund" : "admin-refund", { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = await context?.json?.().catch(() => null);
    return { ok: false, error:
      detail?.error === "refund_amount_changed" ? "The refund amount changed. Close and reopen this dialog to review it."
      : detail?.error === "refund_review_required" ? "This refund needs a payment provider review before it can be retried. Contact platform support."
      : detail?.error === "provider_not_configured" ? "Refunds are temporarily unavailable. Contact platform support."
      : context?.status === 403 ? "You don't have permission to refund this registration."
      : context?.status === 409 ? "This registration cannot be refunded under its current status or policy."
      : context?.status === 404 ? "Registration not found."
      : "Could not confirm the refund result. Close and reopen this dialog to check before retrying." };
  }
  if (group) {
    const amounts = { refund_amount: data?.refund_amount, total_paid: data?.total_paid, retained_fees: data?.retained_fees };
    if (data?.status === "preview") return { ok: true, ...amounts, existing_request: !!data.request_id };
    if (data?.status === "pending") return { ok: true, ...amounts, pending: true };
    if (data?.status === "succeeded") return { ok: true, ...amounts };
    return { ok: false, error: data?.status === "failed"
      ? "The provider reported a failed refund. Contact platform support before starting another attempt."
      : data?.status === "review_required"
        ? "This refund needs a payment provider review. Contact platform support."
        : "Could not confirm the refund result. Close and reopen this dialog to check before retrying." };
  }
  if (data?.ok !== true) return { ok: false, error: "Could not confirm the refund result. Please refresh." };
  return data as RefundResponse;
}

export async function previewRefundAction(registrationId: string, bookingOrderId?: string): Promise<RefundResponse> {
  return bookingOrderId
    ? requestRefund({ order_id: bookingOrderId, registration_ids: [registrationId], idempotency_key: registrationId, preview: true }, true)
    : requestRefund({ registration_id: registrationId, preview: true });
}

/** The edge function recomputes the amount; the preview is only a confirmation guard. */
export async function refundRegistrationAction(
  registrationId: string, note?: string, expectedAmount?: number, bookingOrderId?: string,
): Promise<RefundResponse> {
  // A stable per-participant key survives uncertain responses and dialog reopen.
  // Always select the participant: omitting registration_ids refunds the whole order.
  const result = bookingOrderId
    ? await requestRefund({ order_id: bookingOrderId, registration_ids: [registrationId], idempotency_key: registrationId, preview: false, expected_amount: expectedAmount }, true)
    : await requestRefund({ registration_id: registrationId, note: note ?? null, expected_amount: expectedAmount });
  if (result.ok) {
    revalidatePath("/registrations");
    revalidatePath("/payments");
    revalidatePath("/payouts");
  }
  return result;
}

export type BulkCancelResult = {
  ok: boolean;
  cancelled: number;
  error?: string;
};

/** Bulk "Cancel" from the Registrations toolbar (visual parity V3). Each id
 *  goes through `admin_cancel_registration` — a SECURITY DEFINER RPC (see
 *  supabase/migrations/20260806201000_admin_cancel_registration_rpc.sql)
 *  that re-checks `auth_can_admin_org` itself. UI gating (which roles the
 *  page even shows this button to) is NOT authorization — an editor could
 *  otherwise call this server action directly with someone else's org's
 *  registration ids. This function is a thin relay; the RPC is the actual
 *  gate and runs regardless of what the UI hid.
 *
 *  Runs the caller's own session (createClient() from lib/supabase/server,
 *  never a service-role key) so RLS/the RPC's own check apply exactly as
 *  they would for any other action this admin takes.
 *
 *  A registration that isn't cancellable (already paid — must be refunded,
 *  not cancelled, so money isn't stranded; see the migration's doc comment)
 *  is not an error for the OTHERS in the batch — it's reported back so the
 *  caller can tell the admin "N of M cancelled", not silently drop it or
 *  fail the whole batch over one ineligible row. */
export async function cancelRegistrationsAction(ids: string[]): Promise<BulkCancelResult> {
  if (ids.length === 0) return { ok: false, cancelled: 0, error: "Nothing selected." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, cancelled: 0, error: "You must be signed in." };

  const results = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await supabase.rpc("admin_cancel_registration", { p_registration_id: id });
      if (error) {
        console.error("[registrations] admin_cancel_registration failed", { id, error });
        return { id, status: "error" as const };
      }
      return { id, status: (data as string) ?? "error" };
    }),
  );

  const cancelled = results.filter((r) => r.status === "cancelled").length;
  const unauthorized = results.some((r) => r.status === "unauthorized");
  const notFound = results.filter((r) => r.status === "not_found").length;
  const notCancellable = results.filter((r) => r.status === "not_cancellable").length;
  const paymentInFlight = results.filter((r) => r.status === "payment_in_flight").length;
  const hardError = results.find((r) => r.status === "error");

  // Revalidate whenever ANY row actually wrote, before any of the
  // early-return branches below — not only on the fully-successful path.
  // A mixed batch (e.g. 2 cancelled + 1 unauthorized) used to hit the
  // `unauthorized` branch and return before this ran, so the 2 real writes
  // never reached the cache: those rows kept rendering as "Pending" until
  // some unrelated navigation happened to revalidate the page. The DB was
  // already correct; only the admin's view of it was stale.
  if (cancelled > 0) revalidatePath("/registrations");

  if (unauthorized) {
    return { ok: false, cancelled, error: "You don't have permission to cancel one or more of these registrations." };
  }
  if (hardError) {
    // Never surface `error.message` (raw Postgres text) to the UI — the real
    // error is already logged server-side above, with context. Matches the
    // pattern in lib/actions/settings.ts and refundRegistrationAction.
    return { ok: false, cancelled, error: "Cancel failed. Please try again." };
  }
  if (cancelled === 0) {
    return {
      ok: false,
      cancelled: 0,
      error: paymentInFlight > 0
        ? "Some registrations have a payment in progress — wait for it to complete or fail before cancelling."
        : notCancellable > 0
          ? "Paid registrations can't be cancelled directly — refund them instead."
          : notFound > 0
            ? "Those registrations no longer exist."
            : "Nothing was cancelled.",
    };
  }

  return {
    ok: true,
    cancelled,
    error: cancelled < ids.length
      ? `${ids.length - cancelled} of ${ids.length} couldn't be cancelled (paid, payment in progress, or not found).`
      : undefined,
  };
}
