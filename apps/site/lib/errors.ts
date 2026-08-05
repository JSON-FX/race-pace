import { FunctionsHttpError } from "@supabase/supabase-js";

const MESSAGES: Record<string, string> = {
  sold_out: "This distance just sold out. Try another distance for this race.",
  not_pending: "You've already paid for this registration. Check My Races for your ticket.",
  waiver_required: "Please accept the event waiver before registering.",
  invalid_custom_data: "Some answers need fixing. Check the highlighted fields.",
  invalid_input: "Some details are missing or invalid. Check the form and try again.",
  unauthorized: "Your session expired. Please sign in again.",
  category_not_found: "This distance is no longer available.",
  registration_not_found: "We couldn't find that registration.",
  registration_failed: "We couldn't save your registration. Please try again.",
  server_error: "Something went wrong on our end. Please try again.",
};

export function checkoutErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Please try again.";
}

/** Edge Functions return their error code in the response BODY, not the
 *  message — supabase-js only surfaces "Edge Function returned a non-2xx
 *  status code" without this. Mirrors apps/mobile/lib/registration.ts. */
export async function parseFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return checkoutErrorMessage(String(body.error));
    } catch {
      // Fall through to the generic message.
    }
  }
  return checkoutErrorMessage("server_error");
}
