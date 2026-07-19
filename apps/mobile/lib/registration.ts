import { supabase } from "./supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { RegistrationInput } from "@trail-ultra/shared";
import { useQuery } from "@tanstack/react-query";

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

export type RegistrationRow = {
  id: string;
  status: string;
  total_amount: number;
  ticket_token: string | null;
  org_id: string;
  eventName: string;
  categoryLabel: string;
  checkoutUrl: string | null;
};

const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,events(name),categories(label,distance_km),payments(checkout_url)";

function mapReg(r: any): RegistrationRow {
  const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
  return {
    id: r.id,
    status: r.status,
    total_amount: r.total_amount,
    ticket_token: r.ticket_token ?? null,
    org_id: r.org_id,
    eventName: r.events?.name ?? "Event",
    categoryLabel: r.categories?.label ?? "",
    checkoutUrl: payment?.checkout_url ?? null,
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
    refetchInterval: opts?.poll
      ? (query) => (query.state.data?.status === "paid" ? false : 3000)
      : false,
  });
}

export async function fetchMyRegistrations(orgId: string): Promise<RegistrationRow[]> {
  const { data, error } = await supabase
    .from("registrations")
    .select(REG_SELECT)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapReg);
}

export function useMyRegistrations(orgId: string | null) {
  return useQuery({
    queryKey: ["my-registrations", orgId],
    queryFn: () => fetchMyRegistrations(orgId!),
    enabled: !!orgId,
  });
}
