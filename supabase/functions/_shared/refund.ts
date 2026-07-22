import { serviceClient } from "./supabase.ts";

export type RefundResult =
  | { ok: true; registration_id: string; already?: boolean }
  | { ok: false; error: string; status: number };

/** Refund a paid registration: flip payment + registration to 'refunded' and
 *  release the category slot. Idempotent AND race-safe — the slot is released
 *  only by the caller that actually performs the paid->refunded transition, so a
 *  retry after a partial failure or a concurrent duplicate call cannot
 *  double-release the slot. Caller authorization is the endpoint's responsibility. */
export async function refundRegistration(
  registrationId: string,
  refundedBy: string,
  note: string | null = null,
): Promise<RefundResult> {
  const db = serviceClient();
  const { data: reg, error: regErr } = await db
    .from("registrations")
    .select("id,category_id,status")
    .eq("id", registrationId)
    .single();
  if (regErr || !reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "refunded") return { ok: true, registration_id: reg.id, already: true };
  if (reg.status !== "paid") return { ok: false, error: "not_refundable", status: 409 };

  // Atomic guard: only the caller that flips paid->refunded proceeds to release
  // the slot. A concurrent/duplicate call (or a retry after this already ran)
  // matches zero rows here and returns without decrementing again.
  const { data: flipped, error: flipErr } = await db
    .from("registrations")
    .update({ status: "refunded" })
    .eq("id", reg.id)
    .eq("status", "paid")
    .select("id");
  if (flipErr) return { ok: false, error: "refund_write_failed", status: 500 };
  if (!flipped || flipped.length === 0) return { ok: true, registration_id: reg.id, already: true };

  // Winner: record the payment refund + release the slot exactly once.
  // (PayMongo refund call goes here at the swap point — no-op for the fake provider.)
  const { data: pay } = await db.from("payments").select("raw").eq("registration_id", reg.id).single();
  const raw = { ...((pay?.raw as Record<string, unknown>) ?? {}), refunded_at: new Date().toISOString(), refunded_by: refundedBy, note };
  const { error: payErr } = await db.from("payments").update({ status: "refunded", raw }).eq("registration_id", reg.id);
  if (payErr) return { ok: false, error: "refund_payment_write_failed", status: 500 };
  const { error: slotErr } = await db.rpc("decrement_slot", { p_category_id: reg.category_id });
  if (slotErr) return { ok: false, error: "refund_slot_write_failed", status: 500 };

  return { ok: true, registration_id: reg.id };
}
