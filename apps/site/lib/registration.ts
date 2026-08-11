"use client";

import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { RegistrationInput } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";
import { checkoutErrorMessage } from "@/lib/errors";
import { RATE_METHOD, type FeeTerms, type ProcessorRate } from "@/lib/payment";

export type CheckoutResult = { registration_id: string; checkout_url: string };

/** Where PayMongo sends the runner after pay/cancel. Mobile uses a
 *  racepace:// deep link; the web equivalent is a real route. */
export function payReturnUrl(registrationId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  return `${origin}/pay/callback?rid=${encodeURIComponent(registrationId)}`;
}

/** Thrown by startCheckout. `registrationId` is only set for the
 *  already_registered 409 (registrations-checkout's contract:
 *  { error: "already_registered", registration_id, status, checkout_url }) —
 *  it's what lets RegisterWizard route straight to the runner's existing
 *  entry instead of dead-ending them on a completed three-step form with a
 *  generic error string. Mirrors apps/mobile/lib/registration.ts's
 *  CheckoutError of the same name and shape. */
export class CheckoutError extends Error {
  code: string;
  registrationId?: string;
  constructor(code: string, registrationId?: string) {
    super(checkoutErrorMessage(code));
    this.code = code;
    this.registrationId = registrationId;
  }
}

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  const supabase = createClient();
  // The registration id isn't known yet, so the return URL carries no rid here;
  // /pay/callback falls back to the rid the pay page stored. The per-method
  // session created in createMethodCheckout does include it.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  const body = { ...input, return_url: `${origin}/pay/callback` };
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body });
  if (error) {
    // Edge Functions return their error code in the response BODY, not the
    // message — supabase-js only surfaces "Edge Function returned a non-2xx
    // status code" without this. Mirrors apps/mobile/lib/registration.ts's
    // startCheckout.
    let code = "server_error";
    let registrationId: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) code = String(body.error);
        if (typeof body?.registration_id === "string") registrationId = body.registration_id;
      } catch {
        // keep the generic code
      }
    }
    throw new CheckoutError(code, registrationId);
  }
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
  /** When an unpaid entry stops holding this runner's one-per-event slot.
   *  Null once paid — a paid entry has no hold to run out. */
  expiresAt: string | null;
  eventName: string; categoryLabel: string; categoryDistance: number | null; checkoutUrl: string | null;
  eventStatus: string | null; eventDate: string | null; originalDate: string | null; statusNote: string | null;
  /** Null means "no deadline" — see lib/eventStatus.ts. */
  eventRegistrationClosesAt: string | null;
  /** Null means "no cutoff" — see lib/kit.ts. */
  kitEditClosesAt: string | null;
  shirtSize: string | null;
  orgName: string | null; eventHeroUrl: string | null; basePrice: number | null; inclusions: string[] | null;
  /** Which side of the fees this org's runners are on. `absorb`: the runner pays
   *  the sticker price and the processing cost comes out of the organizer's
   *  share, so it is none of the runner's business. `pass_on`: the runner is
   *  charged a grossed-up total and must therefore see every line of it. */
  feeMode: "absorb" | "pass_on";
  /** The org's commission terms, needed to strike the platform's fee on the base
   *  the organizer priced. Only read in pass_on mode — but read in FULL: the
   *  shape of the commission decides which branch of `feeOn` runs, so carrying
   *  the mode without the terms would quote a percentage to a flat-fee org. */
  feeTerms: FeeTerms;
  payment: RegistrationPayment | null;
};

// The organizations embed carries fee_mode AND all three commission columns,
// not just the mode — see RegistrationRow.feeTerms, and the identical select in
// supabase/functions/payment-session/index.ts, which is where the same terms
// decide what is actually charged.
//
// One string literal, not a concatenation: supabase-js parses the select at the
// type level, and `a + b` is `string` to TypeScript, which erases every column
// type on the result.
const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,event_id,expires_at,custom_data,organizations(name,fee_mode,commission_type,commission_rate,commission_flat_cents),events(name,status,event_date,original_date,status_note,hero_image_url,inclusions,registration_closes_at,kit_edit_closes_at),categories(label,distance_km,base_price),payments(checkout_url,created_at,method,amount,platform_fee,net_to_org,provider,provider_ref,status)";

export function mapReg(r: any): RegistrationRow {
  const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
  // Normalised the same way `payments` is: PostgREST returns a to-one embed as
  // an object, but the shape it infers is not something this mapper should
  // depend on. It matters more here than for `orgName` — an org read as an array
  // would fall to the `absorb` default below, and absorb renders the sticker
  // price for a runner who is about to be charged more than that.
  const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
  return {
    id: r.id, status: r.status, total_amount: r.total_amount,
    ticket_token: r.ticket_token ?? null, org_id: r.org_id, event_id: r.event_id,
    expiresAt: r.expires_at ?? null,
    eventName: r.events?.name ?? "Event",
    categoryLabel: r.categories?.label ?? "",
    categoryDistance: r.categories?.distance_km ?? null,
    orgName: org?.name ?? null,
    eventHeroUrl: r.events?.hero_image_url ?? null,
    basePrice: r.categories?.base_price ?? null,
    inclusions: r.events?.inclusions ?? null,
    // Defaulting to `absorb` rather than throwing: a missing embed must render
    // the sticker price, never an unpriced screen. It is also the column's own
    // default, so the only rows that reach `pass_on` are ones a super admin
    // deliberately moved there.
    feeMode: (org?.fee_mode ?? "absorb") as "absorb" | "pass_on",
    // Mirrors computeFee's own defaults (percent, and a null rate it reads as
    // 10%) so the line this screen shows is the fee the server will strike.
    feeTerms: {
      commission_type: org?.commission_type ?? "percent",
      commission_rate: org?.commission_rate ?? null,
      commission_flat_cents: org?.commission_flat_cents ?? 0,
    },
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

/**
 * The current published price of ONE payment method, or null when the rate card
 * has none — in which case the pay screen shows no pass-on breakdown at all
 * rather than an invented one.
 *
 * Reads the TABLE, not `processor_rate_at`: that RPC is granted to service_role
 * only (20260811091000), deliberately, because every caller of it is
 * server-side. The table itself is readable by any signed-in user under
 * `processor_rates_read` — it is a published price list, not a secret.
 *
 * THREE FILTERS, EACH LOAD-BEARING:
 *  - `offered` is the rate card's own record of what a runner can actually pick
 *    (20260811096500). Rows are seeded ahead of being enabled — `dob` at 80bps
 *    is seeded and its own note says UNCONFIRMED — and pricing a runner's screen
 *    off a method they cannot choose is exactly what the column exists to stop.
 *  - `scope = 'local'` matches what payment-session grosses up with. The card's
 *    issuing country is not known until PayMongo has the card, so an
 *    international rate cannot honestly be quoted here; quoting a DIFFERENT
 *    scope from the one that will be charged is worse than quoting the local
 *    one.
 *  - `effective_to is null` is the current row. `processor_rates_one_current`
 *    makes at most one such row exist per (provider, method, scope), which is
 *    what lets this be a maybeSingle rather than an ordered pick.
 *
 * THIS PREDICATE IS NOT THE SERVER'S, AND CANNOT BE ASSUMED TO AGREE WITH IT.
 * `processor_rate_at` (which payment-session charges from) takes a point in time
 * and does NOT filter on `offered`. So the two disagree in both directions:
 *
 *  - a rate correction that forgets `offered` (it defaults to FALSE — see
 *    20260811096500's own comment) drops the method here while the server still
 *    prices it;
 *  - a rate change scheduled with an `effective_from` in the future, or a row
 *    given an `effective_to`, moves the server's answer at a moment this
 *    `effective_to is null` read does not model.
 *
 * That is survivable only because the caller never falls back to the sticker
 * price: PayPanel prints NO total when this returns null, rather than a number
 * the server would not charge. If that ever changes, this has to become a
 * point-in-time read.
 */
export async function fetchProcessorRate(method: string): Promise<ProcessorRate | null> {
  const rateMethod = RATE_METHOD[method];
  if (!rateMethod) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("processor_rates")
    .select("percent_bps,fixed_cents")
    .eq("provider", "paymongo")
    .eq("method", rateMethod)
    .eq("scope", "local")
    .eq("offered", true)
    .is("effective_to", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // A rate at or above 100% is not a price: the gross-up divides by zero at
  // exactly 100% and inverts above it. `passOnLines` refuses such a rate
  // outright — correctly, there is no honest total to show — but an exception
  // thrown during render would blank the pay screen, so a row that cannot be
  // charged is treated here as the absence of one. The screen then shows no
  // breakdown, and payment-session refuses the charge server-side.
  if (data.percent_bps >= 10000) {
    console.error(`[pay] processor rate ${data.percent_bps}bps for ${rateMethod} is not chargeable`);
    return null;
  }
  return { percent_bps: data.percent_bps, fixed_cents: data.fixed_cents };
}

/** Keyed on the method the runner has selected, so switching payment method
 *  re-prices the screen. `enabled` is how an absorb-mode org avoids the read
 *  entirely: it has no fee lines to show, so the rate is not merely unused there
 *  but irrelevant. `staleTime` because a rate card changes on the order of
 *  months, and flipping between two methods must not refetch a price list. */
export function useProcessorRate(method: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["processor-rate", method],
    queryFn: () => fetchProcessorRate(method),
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60_000,
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
