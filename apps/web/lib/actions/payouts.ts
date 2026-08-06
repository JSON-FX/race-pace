"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Thin relays over the two payout RPCs. Design 2026-08-06 §9.2.
 *
 * Deliberately no `isSuperAdmin` check in this file. A Server Action is a
 * public endpoint, so a check here would be worth having — but it would also
 * be the SECOND copy of the rule, and the copy that money correctness must not
 * depend on. Both RPCs are `security definer` and re-check
 * `auth_is_super_admin()` themselves, raising `42501`; they run under the
 * caller's own session (`createClient()`, never a service-role key), so the
 * database is the gate whatever the UI hid or a hand-rolled POST claimed.
 * These functions exist to translate Postgres error codes into sentences an
 * operator can act on, not to authorize anything.
 */

export type PayoutActionResult = { ok: boolean; error?: string };

type PgError = { code?: string; message?: string };

/** Cut a statement for one event. */
export async function openPayoutStatementAction(eventId: string): Promise<PayoutActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_open_statement", { p_event_id: eventId });

  if (error) {
    const e = error as PgError;
    // 23505: the `payout_statements_one_open_per_event` partial unique index.
    // Not a bug — two operators cutting the same event at once, or a stale
    // page. The invariant held, which is the point of enforcing it in the
    // index rather than with a read-then-write.
    if (e.code === "23505") return { ok: false, error: "This event already has an open statement." };
    if (e.code === "42501") return { ok: false, error: "Only super admins can open a payout statement." };
    if (e.message?.includes("event_not_found")) return { ok: false, error: "Event not found." };
    return { ok: false, error: "Couldn't open the statement. Please try again." };
  }

  revalidatePath("/payouts");
  return { ok: true };
}

/**
 * Settle a statement: marks it paid AND stamps every payment row it covered,
 * in one transaction inside the RPC. Never split those — a crash between two
 * round trips would leave a statement marked paid whose payments are still
 * unstamped, and the next statement would pay the same money again.
 */
export async function markPayoutPaidAction(
  statementId: string,
  reference: string,
  note: string,
): Promise<PayoutActionResult> {
  const trimmedRef = reference.trim();
  // The reference is the only durable link between this row and the actual
  // bank transfer. A settled statement with no reference cannot be reconciled
  // against a statement of account later, so refuse rather than record a
  // payment nobody can prove.
  if (!trimmedRef) return { ok: false, error: "Enter the transfer reference." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_mark_paid", {
    p_statement_id: statementId,
    p_reference: trimmedRef,
    p_note: note.trim() || null,
  });

  if (error) {
    const e = error as PgError;
    if (e.code === "42501") return { ok: false, error: "Only super admins can settle a payout statement." };
    return { ok: false, error: "Couldn't record the settlement. Please try again." };
  }

  // The RPC returns a word rather than throwing, so these are states, not
  // failures — surface them instead of reporting a success that didn't happen.
  if (data === "already") return { ok: false, error: "This statement was already settled." };
  if (data === "not_found") return { ok: false, error: "Statement not found." };

  revalidatePath("/payouts");
  return { ok: true };
}
