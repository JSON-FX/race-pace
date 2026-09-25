"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReservationPayoutState = { error?: string; ok?: boolean };

export async function reservationPayoutAction(
  _previous: ReservationPayoutState, formData: FormData,
): Promise<ReservationPayoutState> {
  const mode = formData.get("mode");
  const id = formData.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid statement or event." };
  const db = await createClient();
  let result;
  if (mode === "open") result = await db.rpc("reservation_payout_open", { p_event_id: id });
  else if (mode === "refresh") result = await db.rpc("reservation_payout_refresh", { p_statement_id: id });
  else if (mode === "pay") {
    const reference = String(formData.get("reference") ?? "").trim();
    const revision = Number(formData.get("revision"));
    if (!reference || !Number.isSafeInteger(revision) || revision < 1) {
      return { error: "Enter the transfer reference and refresh the statement." };
    }
    result = await db.rpc("reservation_payout_mark_paid", {
      p_statement_id: id, p_expected_revision: revision, p_reference: reference,
      p_note: String(formData.get("note") ?? "").trim(),
    });
  } else return { error: "Invalid payout action." };
  if (result.error) {
    if (result.error.code === "42501") return { error: "Only a platform admin can record this payout." };
    if (result.error.message.includes("event_unfinished")) return { error: "Wait until the event has ended." };
    if (result.error.message.includes("reconciliation_required")) return { error: "Reconcile reservation payments before opening a statement." };
    return { error: "The statement could not be updated. Please refresh and try again." };
  }
  if (mode !== "open" && typeof result.data === "string" && !["refreshed", "paid"].includes(result.data)) {
    return { error: result.data === "stale" ? "The amount changed. Refresh the statement before recording a transfer."
      : result.data === "unreconciled" ? "Reconcile reservation payments before paying out."
      : `The statement is ${result.data.replaceAll("_", " ")}.` };
  }
  revalidatePath("/payouts");
  revalidatePath("/commission");
  return { ok: true };
}
