"use client";

import { useQuery } from "@tanstack/react-query";
import type { RegistrationInput } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";
import { parseFunctionError } from "@/lib/errors";

export type CheckoutResult = { registration_id: string; checkout_url: string };

/** Where PayMongo sends the runner after pay/cancel. Mobile uses a
 *  racepace:// deep link; the web equivalent is a real route. */
export function payReturnUrl(registrationId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  return `${origin}/pay/callback?rid=${encodeURIComponent(registrationId)}`;
}

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  const supabase = createClient();
  // The registration id isn't known yet, so the return URL carries no rid here;
  // /pay/callback falls back to the rid the pay page stored. The per-method
  // session created in createMethodCheckout does include it.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  const body = { ...input, return_url: `${origin}/pay/callback` };
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body });
  if (error) throw new Error(await parseFunctionError(error));
  return data as CheckoutResult;
}

/** Confirm server-side by re-fetching the PayMongo session — the redirect is
 *  never trusted. Best-effort: on any error, polling drives the outcome. */
export async function verifyPayment(registrationId: string): Promise<{ status: string }> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("payment-verify", {
      body: { registration_id: registrationId },
    });
    if (error) return { status: "pending" };
    return (data as { status: string }) ?? { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

/** Recreate the checkout scoped to the chosen method so PayMongo opens straight
 *  to it. Returns null on any error; the pay page falls back to the all-methods
 *  session created at registration. */
export async function createMethodCheckout(registrationId: string, method: string): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("payment-session", {
      body: { registration_id: registrationId, method, return_url: payReturnUrl(registrationId) },
    });
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
  /** The race this entry is for — needed to link back to its event page. */
  event_id: string;
  eventName: string; categoryLabel: string; categoryDistance: number | null; checkoutUrl: string | null;
  eventStatus: string | null; eventDate: string | null; originalDate: string | null; statusNote: string | null;
  /** Null means "no deadline" — see lib/eventStatus.ts. */
  eventRegistrationClosesAt: string | null;
  /** Null means "no cutoff" — see lib/kit.ts. */
  kitEditClosesAt: string | null;
  shirtSize: string | null;
  orgName: string | null; eventHeroUrl: string | null; basePrice: number | null; inclusions: string[] | null;
  payment: RegistrationPayment | null;
};

const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,event_id,custom_data,organizations(name),events(name,status,event_date,original_date,status_note,hero_image_url,inclusions,registration_closes_at,kit_edit_closes_at),categories(label,distance_km,base_price),payments(checkout_url,created_at,method,amount,platform_fee,net_to_org,provider,provider_ref,status)";

export function mapReg(r: any): RegistrationRow {
  const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
  return {
    id: r.id, status: r.status, total_amount: r.total_amount,
    ticket_token: r.ticket_token ?? null, org_id: r.org_id, event_id: r.event_id,
    eventName: r.events?.name ?? "Event",
    categoryLabel: r.categories?.label ?? "",
    categoryDistance: r.categories?.distance_km ?? null,
    orgName: r.organizations?.name ?? null,
    eventHeroUrl: r.events?.hero_image_url ?? null,
    basePrice: r.categories?.base_price ?? null,
    inclusions: r.events?.inclusions ?? null,
    checkoutUrl: payment?.checkout_url ?? null,
    eventStatus: r.events?.status ?? null,
    eventRegistrationClosesAt: r.events?.registration_closes_at ?? null,
    kitEditClosesAt: r.events?.kit_edit_closes_at ?? null,
    shirtSize: (r.custom_data as Record<string, unknown> | null)?.shirt_size as string ?? null,
    eventDate: r.events?.event_date ?? null,
    originalDate: r.events?.original_date ?? null,
    statusNote: r.events?.status_note ?? null,
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
  const supabase = createClient();
  const { data, error } = await supabase.from("registrations").select(REG_SELECT).eq("id", rid).maybeSingle();
  if (error) throw error;
  return data ? mapReg(data) : null;
}

/** `enabled` matters on /pay/callback, where the rid is recovered inside an
 *  effect and is briefly "". Querying `.eq("id", "")` against a uuid column is
 *  a Postgres error, so the query must not run until the rid is known. */
export function useRegistration(rid: string, opts?: { poll?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: ["registration", rid],
    queryFn: () => fetchRegistration(rid),
    enabled: (opts?.enabled ?? true) && !!rid,
    refetchInterval: opts?.poll
      ? (query) => (query.state.data?.status === "paid" ? false : 3000)
      : false,
  });
}

/** RLS `registrations_read_own` restricts rows to the signed-in user. */
export async function fetchMyRegistrations(): Promise<RegistrationRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("registrations").select(REG_SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapReg);
}

export function useMyRegistrations() {
  return useQuery({ queryKey: ["my-registrations"], queryFn: fetchMyRegistrations });
}

/** Delete an unpaid registration. RLS `registrations_delete_own_pending`
 *  restricts this to the owner's own pending rows. A zero-row delete means RLS
 *  blocked it, which must surface as an error rather than a silent success. */
export async function cancelRegistration(rid: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("registrations").delete().eq("id", rid).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("not_cancellable");
}
