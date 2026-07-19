import { supabase } from "./supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { RegistrationInput } from "@trail-ultra/shared";

export type CheckoutResult = { registration_id: string; checkout_url: string };

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body: input });
  if (error) {
    let message = error.message || "Checkout failed";
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) message = String(body.error);
      } catch {
        // keep default message
      }
    }
    throw new Error(message);
  }
  return data as CheckoutResult;
}
