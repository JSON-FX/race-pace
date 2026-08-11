import { supabase } from "./supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import type { RegistrationInput } from "@race-pace/shared";
import { useQuery } from "@tanstack/react-query";

export type CheckoutResult = { registration_id: string; checkout_url: string };

// The deep link PayMongo's hosted checkout redirects back to after pay/cancel.
export const PAY_RETURN_PATH = "pay-callback";

/** Thrown by startCheckout. `registrationId` is only set for the
 *  already_registered 409 (registrations-checkout's contract:
 *  { error: "already_registered", registration_id, status, checkout_url }) —
 *  it's what lets the register screen redirect straight to the runner's
 *  existing entry instead of just showing an error string. */
export class CheckoutError extends Error {
  registrationId?: string;
  constructor(message: string, registrationId?: string) {
    super(message);
    this.registrationId = registrationId;
  }
}

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  // Pass the app's return deep link so the server can set PayMongo's success/cancel URLs.
  const body = { ...input, return_url: Linking.createURL(PAY_RETURN_PATH) };
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body });
  if (error) {
    let message = error.message || "Checkout failed";
    let registrationId: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) message = String(body.error);
        if (typeof body?.registration_id === "string") registrationId = body.registration_id;
      } catch {
        // keep default message
      }
    }
    throw new CheckoutError(message, registrationId);
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

/** Recreate the PayMongo checkout scoped to the runner's chosen method, so the hosted page opens
 *  straight to it. Best-effort: returns null on any error, and the pay screen falls back to the
 *  all-methods session created at registration. */
export async function createMethodCheckout(registrationId: string, method: string): Promise<string | null> {
  try {
    const body = { registration_id: registrationId, method, return_url: Linking.createURL(PAY_RETURN_PATH) };
    const { data, error } = await supabase.functions.invoke("payment-session", { body });
    if (error) return null;
    return (data as { checkout_url?: string })?.checkout_url ?? null;
  } catch {
    return null;
  }
}

export type RegistrationPayment = {
  createdAt: string | null; method: string | null; amount: number | null;
  platformFee: number | null; netToOrg: number | null; provider: string | null;
  providerRef: string | null; status: string | null;
};

export type RegistrationRow = {
  id: string; status: string; total_amount: number; ticket_token: string | null; org_id: string;
  /** The race this entry is for — needed to route a lapsed hold back to
   *  re-entry instead of a dead Pay button. Mirrors apps/site's field of the
   *  same name (apps/site/lib/registration.ts's RegistrationRow). */
  event_id: string;
  /** When an unpaid entry stops holding this runner's one-per-event slot.
   *  Null once paid — a paid entry has no hold to run out. Callers must derive
   *  "is this hold actually still live" from this via holdExpired
   *  (lib/holdExpiry.ts), not from `status` alone — see that file's header. */
  expiresAt: string | null;
  eventName: string; categoryLabel: string; categoryDistance: number | null; checkoutUrl: string | null;
  eventStatus: string | null; eventDate: string | null; originalDate: string | null; statusNote: string | null;
  orgName: string | null; eventHeroUrl: string | null; basePrice?: number | null; inclusions?: string[] | null;
  payment: RegistrationPayment | null;
};

const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,event_id,expires_at,organizations(name),events(name,status,event_date,original_date,status_note,hero_image_url,inclusions),categories(label,distance_km,base_price),payments(checkout_url,created_at,method,amount,platform_fee,net_to_org,provider,provider_ref,status)";

function mapReg(r: any): RegistrationRow {
  const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
  return {
    id: r.id, status: r.status, total_amount: r.total_amount, ticket_token: r.ticket_token ?? null, org_id: r.org_id,
    event_id: r.event_id, expiresAt: r.expires_at ?? null,
    eventName: r.events?.name ?? "Event", categoryLabel: r.categories?.label ?? "", categoryDistance: r.categories?.distance_km ?? null,
    orgName: r.organizations?.name ?? null,
    eventHeroUrl: r.events?.hero_image_url ?? null,
    basePrice: r.categories?.base_price ?? null,
    inclusions: r.events?.inclusions ?? null,
    checkoutUrl: payment?.checkout_url ?? null,
    eventStatus: r.events?.status ?? null, eventDate: r.events?.event_date ?? null,
    originalDate: r.events?.original_date ?? null, statusNote: r.events?.status_note ?? null,
    payment: payment
      ? {
          createdAt: payment.created_at ?? null, method: payment.method ?? null,
          amount: payment.amount ?? null, platformFee: payment.platform_fee ?? null,
          netToOrg: payment.net_to_org ?? null, provider: payment.provider ?? null,
          providerRef: payment.provider_ref ?? null, status: payment.status ?? null,
        }
      : null,
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

/** Permanently delete an unpaid (pending) registration. The RLS policy
 *  `registrations_delete_own_pending` restricts this to the owner's own
 *  pending rows; the pending payment and addons cascade away. Not for paid
 *  registrations — those are refunded admin-side, never deleted here.
 *  Throws if RLS blocked the delete (e.g. a payment already captured), since
 *  a zero-row delete otherwise reports success with nothing actually deleted. */
export async function cancelRegistration(rid: string): Promise<void> {
  const { data, error } = await supabase.from("registrations").delete().eq("id", rid).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("not_cancellable");
}
