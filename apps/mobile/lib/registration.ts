import { supabase } from "./supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import type { RegistrationInput } from "@race-pace/shared";
import { useQuery } from "@tanstack/react-query";

export type CheckoutResult = { registration_id: string; checkout_url: string };

// The deep link PayMongo's hosted checkout redirects back to after pay/cancel.
export const PAY_RETURN_PATH = "pay-callback";

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  // Pass the app's return deep link so the server can set PayMongo's success/cancel URLs.
  const body = { ...input, return_url: Linking.createURL(PAY_RETURN_PATH) };
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body });
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

/** Confirm a payment server-side by re-fetching the PayMongo session (the redirect is not
 *  trusted). Best-effort: on any error, polling still drives the outcome. */
export async function verifyPayment(registrationId: string): Promise<{ status: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("payment-verify", {
      body: { registration_id: registrationId },
    });
    if (error) return { status: "pending" };
    return (data as { status: string }) ?? { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

export type RegistrationRow = {
  id: string; status: string; total_amount: number; ticket_token: string | null; org_id: string;
  eventName: string; categoryLabel: string; categoryDistance: number | null; checkoutUrl: string | null;
  eventStatus: string | null; eventDate: string | null; originalDate: string | null; statusNote: string | null;
};

const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,events(name,status,event_date,original_date,status_note),categories(label,distance_km),payments(checkout_url)";

function mapReg(r: any): RegistrationRow {
  const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
  return {
    id: r.id, status: r.status, total_amount: r.total_amount, ticket_token: r.ticket_token ?? null, org_id: r.org_id,
    eventName: r.events?.name ?? "Event", categoryLabel: r.categories?.label ?? "", categoryDistance: r.categories?.distance_km ?? null,
    checkoutUrl: payment?.checkout_url ?? null,
    eventStatus: r.events?.status ?? null, eventDate: r.events?.event_date ?? null,
    originalDate: r.events?.original_date ?? null, statusNote: r.events?.status_note ?? null,
  };
}

export async function fetchRegistration(rid: string): Promise<RegistrationRow | null> {
  const { data, error } = await supabase.from("registrations").select(REG_SELECT).eq("id", rid).maybeSingle();
  if (error) throw error;
  return data ? mapReg(data) : null;
}

export function useRegistration(rid: string, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["registration", rid],
    queryFn: () => fetchRegistration(rid),
    refetchInterval: opts?.poll ? (query) => (query.state.data?.status === "paid" ? false : 3000) : false,
  });
}

// RLS `registrations_read_own` restricts rows to the signed-in user, so no org filter.
export async function fetchMyRegistrations(): Promise<RegistrationRow[]> {
  const { data, error } = await supabase.from("registrations").select(REG_SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapReg);
}

export function useMyRegistrations() {
  return useQuery({ queryKey: ["my-registrations"], queryFn: fetchMyRegistrations });
}
