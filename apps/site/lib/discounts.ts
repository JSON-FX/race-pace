"use client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { DISCOUNT_ERRORS, type DiscountQuote } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";
import { checkoutErrorMessage } from "@/lib/errors";
export async function applyDiscount(
  registrationId: string,
  code: string,
): Promise<DiscountQuote> {
  const result = await createClient().functions.invoke("discount-checkout", {
    body: { action: "apply", registration_id: registrationId, code },
  });
  if (result.error) {
    let reason = "discount_unavailable";
    if (result.error instanceof FunctionsHttpError) {
      try {
        reason = (await result.error.context.json()).error ?? reason;
      } catch {
        /* Preserve transport failure. */
      }
    }
    throw new Error(DISCOUNT_ERRORS[reason] ?? checkoutErrorMessage(reason));
  }
  return result.data as DiscountQuote;
}

export async function restartDiscountCheckout(registrationId: string) {
  const result = await createClient().functions.invoke("discount-checkout", {
    body: { action: "restart", registration_id: registrationId },
  });
  if (result.error)
    throw new Error(
      "Payment could not be closed safely. Return from PayMongo and try again, or contact support.",
    );
}
