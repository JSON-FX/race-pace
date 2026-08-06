"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Full refund via the admin-refund Edge Function, which owns the atomic
 *  money transition. Never update payment_status directly from here. */
export async function refundRegistrationAction(
  registrationId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke("admin-refund", {
    body: { registration_id: registrationId, note: note ?? null },
  });

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return {
      ok: false,
      error:
        status === 403 ? "You don't have permission to refund this registration."
        : status === 409 ? "This registration can't be refunded — it isn't paid."
        : status === 404 ? "Registration not found."
        : "Refund failed. Please try again.",
    };
  }

  revalidatePath("/registrations");
  revalidatePath("/payments");
  return { ok: true };
}
